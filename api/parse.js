import cors from 'cors';

// Enable CORS for Vercel
const corsHandler = cors({
  origin: true,
  credentials: true
});

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(200).end();
    return;
  }

  // Enable CORS for actual requests
  await new Promise((resolve) => corsHandler(req, res, resolve));

  try {
    if (req.method === 'GET') {
      // Handle GET request for playlist parsing
      const { url, type } = req.query;
      
      if (!url) {
        return res.status(400).json({ 
          error: 'URL parameter is required',
          example: '/api/parse?url=https://example.com/playlist.m3u&type=m3u'
        });
      }

      // Mock response for now - you can implement actual parsing logic here
      res.status(200).json({
        success: true,
        message: 'Playlist parsing endpoint',
        url: url,
        type: type || 'auto-detect',
        timestamp: new Date().toISOString()
      });
    } else if (req.method === 'POST') {
      // Handle POST request for playlist parsing
      const { url, content, type } = req.body;
      
      if (!url && !content) {
        return res.status(400).json({ 
          error: 'Either URL or content is required',
          example: { url: 'https://example.com/playlist.m3u', type: 'm3u' }
        });
      }

      // Mock response for now - you can implement actual parsing logic here
      res.status(200).json({
        success: true,
        message: 'Playlist parsing endpoint (POST)',
        url: url,
        hasContent: !!content,
        type: type || 'auto-detect',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    }
  } catch (error) {
    console.error('Parse API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
