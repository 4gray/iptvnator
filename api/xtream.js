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
    // Extract all parameters from query
    const params = req.query;
    console.log('Received params:', params);

    const { url, username, password, action } = params;

    if (!url || !username || !password || !action) {
      console.log('Missing parameters:', { url: !!url, username: !!username, password: !!password, action: !!action });
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: url, username, password, action'
      });
    }

    // Construct the Xtream API URL
    const apiUrl = new URL(`${url}/player_api.php`);
    
    // Add all parameters to the URL
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'url') { // Don't add the url parameter itself
        apiUrl.searchParams.append(key, value);
      }
    });

    console.log('Requesting:', apiUrl.toString());

    // Make request to IPTV server
    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      console.log('Response not OK:', response.status, response.statusText);
      return res.status(200).json({
        status: 'error',
        message: `IPTV server responded with status ${response.status}`
      });
    }

    const data = await response.json();
    console.log('Response data:', data);
    
    // Return the response in the exact format expected by the frontend
    // The PWA service checks for response.payload, so we need to wrap it
    res.status(200).json({
      payload: data
    });

  } catch (error) {
    console.error('CORS Proxy Error:', error);
    res.status(200).json({
      status: 'error',
      message: error.message || 'Internal server error'
    });
  }
}
