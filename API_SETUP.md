# Ruvo Player API Setup Guide

## 🚀 Quick Fix for M3U Link Errors

The 404 errors you're experiencing are because your app is trying to call `https://ruvoplayer.vercel.app/api/parse` which doesn't exist. Here are two solutions:

## Option 1: Local Development Server (Recommended for Development)

### Step 1: Install Dependencies

**PowerShell (Recommended):**

```powershell
cd api
npm install
```

**Command Prompt:**

```cmd
cd api
npm install
```

### Step 2: Start the Local Server

**PowerShell:**

```powershell
npm run dev
```

**Command Prompt:**

```cmd
npm run dev
```

**Or use the startup scripts:**

-   **Windows Batch:** Double-click `start-api.bat`
-   **PowerShell:** Right-click `start-api.ps1` → "Run with PowerShell"

The server will start on `http://localhost:3333`

### Step 3: Update Environment (Already Done)

Your `environment.ts` is already configured to use `http://localhost:3333/api`

### Step 4: Test

-   Open your app
-   Try adding an M3U playlist
-   Check the console for successful API calls

## Option 2: Deploy to Vercel (Production)

### Step 1: Install Vercel CLI

```bash
npm i -g vercel
```

### Step 2: Deploy API

```bash
cd api
vercel --prod
```

### Step 3: Update Environment URLs

Update all environment files to use your new Vercel URL:

```typescript
BACKEND_URL: 'https://your-vercel-app.vercel.app/api';
```

## 🔧 Troubleshooting

### Common Issues:

1. **Port Already in Use**

    - Change PORT in `api/server.js` (line 20)
    - Update `environment.ts` accordingly

2. **CORS Errors**

    - The local server includes CORS headers
    - Check browser console for specific errors

3. **API Endpoints Not Found**

    - Verify server is running on correct port
    - Check `http://localhost:3333/health` endpoint

4. **Module Import Errors**
    - ✅ **Fixed:** Added `"type": "module"` to package.json
    - ✅ **Fixed:** Corrected import statements in server.js
    - ✅ **Fixed:** Added fetch polyfill for Node.js compatibility

### Testing API Endpoints:

**PowerShell:**

```powershell
# Health check
Invoke-RestMethod -Uri "http://localhost:3333/health"

# Test parse endpoint
Invoke-RestMethod -Uri "http://localhost:3333/api/parse?url=https://example.com/playlist.m3u"

# Test xtream endpoint
Invoke-RestMethod -Uri "http://localhost:3333/api/xtream?url=http://server.com&username=user&password=pass&action=user_info"
```

**Command Prompt:**

```cmd
# Health check
curl http://localhost:3333/health

# Test parse endpoint
curl "http://localhost:3333/api/parse?url=https://example.com/playlist.m3u"

# Test xtream endpoint
curl "http://localhost:3333/api/xtream?url=http://server.com&username=user&password=pass&action=user_info"
```

## 📁 File Structure

```
api/
├── server.js          # Express server (NEW)
├── parse.js           # M3U playlist parser
├── xtream.js          # Xtream codes API proxy
├── package.json       # Dependencies with "type": "module"
├── start-api.bat      # Windows batch startup script
├── start-api.ps1      # PowerShell startup script
└── node_modules/      # Installed packages
```

## 🎯 What This Fixes

-   ✅ **404 Errors**: Local API server responds to all requests
-   ✅ **CORS Issues**: Proper headers for cross-origin requests
-   ✅ **M3U Parsing**: Playlist parsing works locally
-   ✅ **Xtream Codes**: IPTV server connections work
-   ✅ **Development**: No external dependencies for testing
-   ✅ **Module Errors**: Fixed ES module import issues
-   ✅ **PowerShell Compatibility**: Added PowerShell startup script

## 🚀 Next Steps

1. **Start with Option 1** (local server) for development
2. **Use PowerShell scripts** for better compatibility
3. **Deploy to Vercel** when ready for production
4. **Update all environment files** with correct URLs
5. **Test thoroughly** with various M3U playlists

## 🎉 **All Issues Fixed!**

-   ✅ **ES Module warnings** - Fixed with `"type": "module"`
-   ✅ **Import errors** - Fixed import statements
-   ✅ **PowerShell compatibility** - Added PowerShell script
-   ✅ **Fetch polyfill** - Added for Node.js compatibility

Your M3U links should now work perfectly! 🎉
