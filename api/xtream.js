export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { url, username, password, action } = req.query;

    if (!url || !username || !password || !action) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: url, username, password, action'
      });
    }

    // Construct the Xtream API URL
    const apiUrl = new URL(`${url}/player_api.php`);
    apiUrl.searchParams.append('username', username);
    apiUrl.searchParams.append('password', password);
    apiUrl.searchParams.append('action', action);

    console.log('Requesting:', apiUrl.toString());

    // Make request to IPTV server
    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        status: 'error',
        message: `IPTV server responded with status ${response.status}`
      });
    }

    const data = await response.json();
    
    // Return the response in the expected format
    res.status(200).json({
      payload: data,
      status: 'success'
    });

  } catch (error) {
    console.error('CORS Proxy Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Internal server error'
    });
  }
}
