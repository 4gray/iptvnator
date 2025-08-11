export default function handler(req, res) {
  res.status(200).json({
    message: 'Ruvo Player API is running',
    endpoints: {
      parse: '/api/parse',
      xtream: '/api/xtream'
    },
    timestamp: new Date().toISOString()
  });
}
