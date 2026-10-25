import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const { Pool } = pg;

/**
 * Universal Database Service supporting both SQLite (local/default)
 * and PostgreSQL (production cloud) seamlessly via DATABASE_URL.
 */
class DatabaseService {
  constructor() {
    this.type = config.database.type;
    this.sqliteDb = null;
    this.pgPool = null;
    this.initialized = false;
  }

  /**
   * Initializes the database connection, creates tables, and auto-seeds initial FAQs.
   */
  async initialize() {
    if (this.initialized) return;

    if (this.type === 'postgres' && config.database.url) {
      try {
        logger.info(`Connecting to PostgreSQL via DATABASE_URL...`);
        this.pgPool = new Pool({
          connectionString: config.database.url,
          ssl: config.server.isProduction ? { rejectUnauthorized: false } : false
        });
        // Test connection
        await this.pgPool.query('SELECT 1');
        logger.info('Connected successfully to PostgreSQL database.');
      } catch (err) {
        logger.error('Failed to connect to PostgreSQL. Falling back to local SQLite:', err.message);
        this.type = 'sqlite';
        this.pgPool = null;
      }
    } else {
      this.type = 'sqlite';
    }

    if (this.type === 'sqlite') {
      const dataDir = config.paths.data;
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      logger.info(`Initializing local SQLite database at: ${config.database.sqlitePath}`);
      this.sqliteDb = new DatabaseSync(config.database.sqlitePath);
      // Enable WAL mode for high concurrency
      this.sqliteDb.exec('PRAGMA journal_mode = WAL;');
    }

    // Auto-create required tables
    await this.createTables();

    // Auto-seed FAQs if table is empty
    await this.seedFAQsIfEmpty();

    this.initialized = true;
    logger.info(`Database service ready [Provider: ${this.type.toUpperCase()}]`);
  }

  /**
   * Translates standard SQL with '?' parameter placeholders for either engine.
   */
  async executeQuery(sql, params = []) {
    if (this.type === 'sqlite') {
      const stmt = this.sqliteDb.prepare(sql);
      // Check if query is a SELECT
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...params);
      } else {
        const info = stmt.run(...params);
        return {
          rowCount: info.changes,
          lastInsertRowid: info.lastInsertRowid
        };
      }
    } else {
      // PostgreSQL: Convert '?' to '$1', '$2', ...
      let paramIndex = 1;
      const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
      const result = await this.pgPool.query(pgSql, params);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return result.rows;
      } else {
        return {
          rowCount: result.rowCount,
          lastInsertRowid: result.rows[0]?.id
        };
      }
    }
  }

  /**
   * Creates the database tables on startup.
   */
  async createTables() {
    logger.info('Verifying database tables schema...');

    if (this.type === 'sqlite') {
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS enquiry_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'web',
          language TEXT NOT NULL DEFAULT 'en-IN',
          question_text TEXT NOT NULL,
          matched_faq TEXT,
          score REAL NOT NULL,
          status TEXT NOT NULL,
          llm_used INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS faqs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          question TEXT NOT NULL UNIQUE,
          answer TEXT NOT NULL,
          question_hi TEXT,
          answer_en_spoken TEXT,
          answer_hi_spoken TEXT,
          review_status TEXT NOT NULL DEFAULT 'draft',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
          token TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON enquiry_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_status ON enquiry_logs(status);
        CREATE INDEX IF NOT EXISTS idx_logs_channel ON enquiry_logs(channel);
      `);

      // Migrations: Add new columns if tables existed from previous version
      const sqliteMigrations = [
        'ALTER TABLE enquiry_logs ADD COLUMN llm_used INTEGER NOT NULL DEFAULT 0;',
        'ALTER TABLE faqs ADD COLUMN question_hi TEXT;',
        'ALTER TABLE faqs ADD COLUMN answer_en_spoken TEXT;',
        'ALTER TABLE faqs ADD COLUMN answer_hi_spoken TEXT;',
        "ALTER TABLE faqs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'draft';"
      ];
      for (const sql of sqliteMigrations) {
        try {
          this.sqliteDb.exec(sql);
        } catch {
          // Column already exists
        }
      }

      try {
        this.sqliteDb.exec('CREATE INDEX IF NOT EXISTS idx_faqs_review ON faqs(review_status);');
      } catch {
        // Ignored
      }
    } else {
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS enquiry_logs (
          id SERIAL PRIMARY KEY,
          timestamp VARCHAR(64) NOT NULL,
          channel VARCHAR(32) NOT NULL DEFAULT 'web',
          language VARCHAR(32) NOT NULL DEFAULT 'en-IN',
          question_text TEXT NOT NULL,
          matched_faq TEXT,
          score DOUBLE PRECISION NOT NULL,
          status VARCHAR(32) NOT NULL,
          llm_used BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS faqs (
          id SERIAL PRIMARY KEY,
          question TEXT NOT NULL UNIQUE,
          answer TEXT NOT NULL,
          question_hi TEXT,
          answer_en_spoken TEXT,
          answer_hi_spoken TEXT,
          review_status VARCHAR(32) NOT NULL DEFAULT 'draft',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
          token VARCHAR(128) PRIMARY KEY,
          username VARCHAR(64) NOT NULL,
          expires_at BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON enquiry_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_status ON enquiry_logs(status);
        CREATE INDEX IF NOT EXISTS idx_logs_channel ON enquiry_logs(channel);
        CREATE INDEX IF NOT EXISTS idx_faqs_review ON faqs(review_status);
      `);

      const pgMigrations = [
        'ALTER TABLE faqs ADD COLUMN IF NOT EXISTS question_hi TEXT;',
        'ALTER TABLE faqs ADD COLUMN IF NOT EXISTS answer_en_spoken TEXT;',
        'ALTER TABLE faqs ADD COLUMN IF NOT EXISTS answer_hi_spoken TEXT;',
        "ALTER TABLE faqs ADD COLUMN IF NOT EXISTS review_status VARCHAR(32) NOT NULL DEFAULT 'draft';"
      ];
      for (const sql of pgMigrations) {
        try {
          await this.pgPool.query(sql);
        } catch {}
      }

      // Migration: Add llm_used column if table existed in PostgreSQL
      try {
        await this.pgPool.query('ALTER TABLE enquiry_logs ADD COLUMN IF NOT EXISTS llm_used BOOLEAN NOT NULL DEFAULT FALSE;');
      } catch {
        // Column already exists
      }
    }
  }

  /**
   * Seeds initial FAQs from faq.json if database table is empty.
   */
  async seedFAQsIfEmpty() {
    const existing = await this.executeQuery('SELECT COUNT(*) as count FROM faqs');
    const count = parseInt(existing[0].count, 10);

    if (count === 0 && fs.existsSync(config.database.faqDataPath)) {
      logger.info(`Seeding faqs table from ${config.database.faqDataPath}...`);
      const raw = fs.readFileSync(config.database.faqDataPath, 'utf-8');
      const faqs = JSON.parse(raw);

      for (const item of faqs) {
        const qHi = item.question_hi || null;
        const aEnSpoken = item.answer_en_spoken || null;
        const aHiSpoken = item.answer_hi_spoken || null;
        const status = item.review_status || 'draft';

        if (this.type === 'sqlite') {
          this.sqliteDb.prepare(`
            INSERT OR IGNORE INTO faqs (question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(item.question.trim(), item.answer.trim(), qHi, aEnSpoken, aHiSpoken, status);
        } else {
          await this.pgPool.query(`
            INSERT INTO faqs (question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (question) DO NOTHING
          `, [item.question.trim(), item.answer.trim(), qHi, aEnSpoken, aHiSpoken, status]);
        }
      }

      logger.info(`Seeded ${faqs.length} FAQs into database.`);
    }
  }

  // ==========================================
  // FAQ CRUD Methods
  // ==========================================

  async loadFAQs({ reviewStatus } = {}) {
    let sql = 'SELECT id, question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status FROM faqs';
    const params = [];
    if (reviewStatus && reviewStatus !== 'all') {
      sql += ' WHERE review_status = ?';
      params.push(reviewStatus);
    }
    sql += ' ORDER BY id ASC';
    const rows = await this.executeQuery(sql, params);
    return rows;
  }

  async getFAQById(id) {
    const rows = await this.executeQuery(
      'SELECT id, question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status FROM faqs WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  async createFAQ(question, answer, extra = {}) {
    const trimmedQ = (typeof question === 'object' ? question.question : question).trim();
    const trimmedA = (typeof question === 'object' ? question.answer : answer).trim();
    const qHi = (typeof question === 'object' ? question.question_hi : extra.question_hi) || null;
    const aEnSpoken = (typeof question === 'object' ? question.answer_en_spoken : extra.answer_en_spoken) || null;
    const aHiSpoken = (typeof question === 'object' ? question.answer_hi_spoken : extra.answer_hi_spoken) || null;
    const status = (typeof question === 'object' ? question.review_status : extra.review_status) || 'draft';

    if (this.type === 'sqlite') {
      const info = this.sqliteDb.prepare(`
        INSERT INTO faqs (question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(trimmedQ, trimmedA, qHi, aEnSpoken, aHiSpoken, status);
      return {
        id: Number(info.lastInsertRowid),
        question: trimmedQ,
        answer: trimmedA,
        question_hi: qHi,
        answer_en_spoken: aEnSpoken,
        answer_hi_spoken: aHiSpoken,
        review_status: status
      };
    } else {
      const res = await this.pgPool.query(`
        INSERT INTO faqs (question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, question, answer, question_hi, answer_en_spoken, answer_hi_spoken, review_status
      `, [trimmedQ, trimmedA, qHi, aEnSpoken, aHiSpoken, status]);
      return res.rows[0];
    }
  }

  async updateFAQ(id, question, answer, extra = {}) {
    const trimmedQ = (typeof question === 'object' ? question.question : question).trim();
    const trimmedA = (typeof question === 'object' ? question.answer : answer).trim();
    const qHi = (typeof question === 'object' ? question.question_hi : extra.question_hi) || null;
    const aEnSpoken = (typeof question === 'object' ? question.answer_en_spoken : extra.answer_en_spoken) || null;
    const aHiSpoken = (typeof question === 'object' ? question.answer_hi_spoken : extra.answer_hi_spoken) || null;
    const status = (typeof question === 'object' ? question.review_status : extra.review_status) || 'draft';
    const now = new Date().toISOString();

    await this.executeQuery(`
      UPDATE faqs
      SET question = ?, answer = ?, question_hi = ?, answer_en_spoken = ?, answer_hi_spoken = ?, review_status = ?, updated_at = ?
      WHERE id = ?
    `, [trimmedQ, trimmedA, qHi, aEnSpoken, aHiSpoken, status, now, id]);

    return {
      id: Number(id),
      question: trimmedQ,
      answer: trimmedA,
      question_hi: qHi,
      answer_en_spoken: aEnSpoken,
      answer_hi_spoken: aHiSpoken,
      review_status: status
    };
  }

  async deleteFAQ(id) {
    const faq = await this.getFAQById(id);
    if (!faq) return false;

    await this.executeQuery('DELETE FROM faqs WHERE id = ?', [id]);
    return true;
  }

  // ==========================================
  // Enquiry Logging & Querying Methods
  // ==========================================

  /**
   * Logs an admission enquiry into enquiry_logs table.
   * Only logs operational data (no sensitive PII).
   */
  async logEnquiry({ channel = 'web', language = 'en-IN', questionText, matchedFaq, score, status, llmUsed = false }) {
    const timestamp = new Date().toISOString();
    const normalizedChannel = (channel || 'web').toLowerCase();
    const normalizedStatus = (status || 'answered').toLowerCase();
    const llmUsedVal = this.type === 'sqlite' ? (llmUsed ? 1 : 0) : Boolean(llmUsed);

    await this.executeQuery(`
      INSERT INTO enquiry_logs (timestamp, channel, language, question_text, matched_faq, score, status, llm_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [timestamp, normalizedChannel, language, questionText, matchedFaq || null, score, normalizedStatus, llmUsedVal]);

    return { success: true };
  }

  /**
   * Fetches paginated & filtered enquiry logs.
   */
  async getEnquiryLogs({ limit = 50, offset = 0, status, channel, search } = {}) {
    let whereClauses = [];
    let params = [];

    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      params.push(status.toLowerCase());
    }

    if (channel && channel !== 'all') {
      whereClauses.push('channel = ?');
      params.push(channel.toLowerCase());
    }

    if (search && search.trim()) {
      whereClauses.push('(question_text LIKE ? OR matched_faq LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // Count total matching
    const countSql = `SELECT COUNT(*) as total FROM enquiry_logs ${whereSql}`;
    const countRes = await this.executeQuery(countSql, params);
    const totalCount = parseInt(countRes[0]?.total || 0, 10);

    // Fetch page items
    const querySql = `
      SELECT id, timestamp, channel, language, question_text, matched_faq, score, status, llm_used
      FROM enquiry_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.executeQuery(querySql, [...params, limit, offset]);

    return {
      total: totalCount,
      limit,
      offset,
      logs: rows
    };
  }

  /**
   * Fetches queries that triggered staff handoff (missing from FAQ).
   */
  async getHandedOffLogs({ limit = 50, offset = 0 } = {}) {
    return this.getEnquiryLogs({ status: 'handed_off', limit, offset });
  }

  /**
   * Returns analytical statistics for the admin dashboard.
   */
  async getStats() {
    const totalRow = await this.executeQuery('SELECT COUNT(*) as total FROM enquiry_logs');
    const total = parseInt(totalRow[0]?.total || 0, 10);

    const answeredRow = await this.executeQuery("SELECT COUNT(*) as answered FROM enquiry_logs WHERE status = 'answered'");
    const answeredCount = parseInt(answeredRow[0]?.answered || 0, 10);

    const handedOffRow = await this.executeQuery("SELECT COUNT(*) as handed_off FROM enquiry_logs WHERE status = 'handed_off'");
    const handedOffCount = parseInt(handedOffRow[0]?.handed_off || 0, 10);

    const faqRow = await this.executeQuery('SELECT COUNT(*) as faqs FROM faqs');
    const totalFaqs = parseInt(faqRow[0]?.faqs || 0, 10);

    const answeredPercent = total > 0 ? Number(((answeredCount / total) * 100).toFixed(1)) : 0;
    const handedOffPercent = total > 0 ? Number(((handedOffCount / total) * 100).toFixed(1)) : 0;

    return {
      totalQuestions: total,
      answeredCount,
      handedOffCount,
      answeredPercent,
      handedOffPercent,
      totalFaqs
    };
  }

  /**
   * Generates a CSV export string of enquiry logs.
   */
  async exportLogsCSV({ status, channel } = {}) {
    let whereClauses = [];
    let params = [];

    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      params.push(status.toLowerCase());
    }

    if (channel && channel !== 'all') {
      whereClauses.push('channel = ?');
      params.push(channel.toLowerCase());
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `
      SELECT id, timestamp, channel, language, question_text, matched_faq, score, status, llm_used
      FROM enquiry_logs
      ${whereSql}
      ORDER BY id DESC
    `;
    const rows = await this.executeQuery(sql, params);

    // Escape CSV cell
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = ['ID', 'Timestamp', 'Channel', 'Language', 'Question Text', 'Matched FAQ', 'Similarity Score', 'Status', 'LLM Used'];
    const lines = [headers.join(',')];

    for (const r of rows) {
      lines.push([
        r.id,
        escapeCsv(r.timestamp),
        escapeCsv(r.channel),
        escapeCsv(r.language),
        escapeCsv(r.question_text),
        escapeCsv(r.matched_faq),
        r.score,
        escapeCsv(r.status),
        escapeCsv(r.llm_used ? 'Yes' : 'No')
      ].join(','));
    }

    return lines.join('\r\n');
  }

  // ==========================================
  // Session Management Methods
  // ==========================================

  async saveSession(token, username, expiresAt) {
    await this.executeQuery(`
      INSERT INTO admin_sessions (token, username, expires_at) VALUES (?, ?, ?)
    `, [token, username, expiresAt]);
  }

  async getSession(token) {
    const now = Date.now();
    const rows = await this.executeQuery(`
      SELECT token, username, expires_at FROM admin_sessions WHERE token = ? AND expires_at > ?
    `, [token, now]);
    return rows[0] || null;
  }

  async deleteSession(token) {
    await this.executeQuery('DELETE FROM admin_sessions WHERE token = ?', [token]);
  }

  async cleanupExpiredSessions() {
    const now = Date.now();
    await this.executeQuery('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
  }

  /**
   * Health status of database
   */
  getStatus() {
    return {
      provider: this.type,
      connected: this.initialized,
      databaseTarget: this.type === 'sqlite' ? config.database.sqlitePath : 'PostgreSQL Cloud'
    };
  }
}

export const databaseService = new DatabaseService();
export default databaseService;
