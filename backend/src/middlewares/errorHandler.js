export function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  console.error(`[error] ${req.method} ${req.originalUrl} ->`, err.message);
  res.status(status).json({
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
}
