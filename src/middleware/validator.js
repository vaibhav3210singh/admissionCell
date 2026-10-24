/**
 * Input validation middleware for admission enquiry endpoints.
 */
export function validateAskRequest(req, res, next) {
  const { question } = req.body || {};

  if (!question || typeof question !== 'string') {
    return res.status(400).json({
      error: 'Invalid Request',
      message: 'The "question" field is required and must be a valid text string.'
    });
  }

  const trimmed = question.trim();

  if (trimmed.length < 2) {
    return res.status(400).json({
      error: 'Invalid Question Length',
      message: 'Question is too short. Please provide a question with at least 2 characters.'
    });
  }

  if (trimmed.length > 1000) {
    return res.status(400).json({
      error: 'Invalid Question Length',
      message: 'Question exceeds maximum limit of 1000 characters.'
    });
  }

  // Attach sanitized question to request object
  req.sanitizedQuestion = trimmed;
  next();
}

export default {
  validateAskRequest
};
