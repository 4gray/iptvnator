# Ruvo Player - Troubleshooting Guide

## 🔧 Common Issues & Solutions

### Issue: "Cannot connect to portal" - Xtream Code Connection Failed

**Symptoms:**
- ✅ IPTV server credentials are correct
- ✅ Connection works on other IPTV players
- ❌ "Test Connection" fails in Ruvo Player
- ❌ Shows "Could not connect to portal" error

**Root Cause:**
CORS (Cross-Origin Resource Sharing) restrictions prevent the web browser from directly connecting to IPTV servers. The application requires a backend proxy to handle these requests.

**Solution Applied:**
Created a custom Vercel serverless function to act as a CORS proxy specifically for Ruvo Player.

#### Files Created/Modified:

1. **`api/xtream.js`** - Custom CORS proxy backend
   ```javascript
   // Handles all Xtream Code API requests
   // Adds proper CORS headers
   // Forwards requests to IPTV servers
   // Returns response in { payload: data } format
   ```

2. **`api/package.json`** - Backend dependencies
   ```json
   {
     "dependencies": {
       "node-fetch": "^3.0.0"
     }
   }
   ```

3. **`src/environments/environment.prod.ts`** - Updated backend URL
   ```typescript
   BACKEND_URL: 'https://ruvoplayer.vercel.app/api'
   ```

#### Technical Details:

**The Problem:**
- Original app used IPTVnator's CORS proxy (`iptvnator-playlist-parser-api.vercel.app`)
- This proxy likely had domain restrictions or rate limits
- Frontend expected response format: `{ payload: actualData }`
- Backend was initially returning wrong format

**The Fix:**
1. **Custom Backend**: Created dedicated serverless function at `/api/xtream`
2. **Proper CORS Headers**: Added `Access-Control-Allow-Origin: *`
3. **Correct Response Format**: Wrapped data in `payload` object
4. **Parameter Forwarding**: Properly extracted and forwarded all query parameters
5. **Error Handling**: Added comprehensive logging and error responses

#### Key Code Snippets:

**Frontend Check (PWA Service):**
```typescript
if (!(response as any).payload) {
    // Error handling - no payload found
} else {
    // Success - payload exists
    result = {
        type: XTREAM_RESPONSE,
        payload: (response as any).payload,
        action: payload.params.action,
    };
}
```

**Backend Response Format:**
```javascript
// CORRECT - Frontend expects this format
res.status(200).json({
    payload: data  // Actual IPTV server response
});

// WRONG - Would cause "cannot connect" error
res.status(200).json(data);
```

#### Testing Process:

1. **Verify IPTV Server Response**: Check that credentials work with direct API calls
2. **Check Backend Logs**: Use browser DevTools Console to see backend logs
3. **Verify Response Format**: Ensure response has `payload` property
4. **Test Frontend Integration**: Confirm "Test Connection" shows success

#### Prevention:

- Always test CORS proxy functionality when deploying to new domains
- Verify response format matches frontend expectations
- Check browser DevTools Network tab for CORS errors
- Monitor backend logs for request/response debugging

---

## 🚀 Deployment Notes

### Vercel Configuration

**vercel.json:**
```json
{
  "version": 2,
  "name": "ruvo-player",
  "buildCommand": "npm run build:prod",
  "outputDirectory": "dist/browser",
  "installCommand": "npm install",
  "framework": null,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### Environment Setup

- **Development**: `BACKEND_URL: 'http://localhost:3333'`
- **Production**: `BACKEND_URL: 'https://ruvoplayer.vercel.app/api'`

---

## 📝 Success Indicators

When everything is working correctly:

1. **✅ Test Connection**: Shows green checkmark "Connection successful! Portal is active."
2. **✅ Add Button**: Becomes enabled after successful test
3. **✅ Playlist Loading**: Channels load without errors
4. **✅ Video Playback**: Streams play smoothly

---

## 🆘 Emergency Fallback

If the custom backend fails, temporary fallback options:

1. **Public CORS Proxy**: `https://api.allorigins.win/get?url=`
2. **Alternative Proxy**: `https://cors-anywhere.herokuapp.com/`

**Note**: Public proxies have rate limits and reliability issues. Custom backend is recommended.

---

*Last Updated: January 2025*
*Issue Resolved: CORS proxy backend implementation*
