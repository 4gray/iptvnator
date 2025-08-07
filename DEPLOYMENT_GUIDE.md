# Ruvo Player - Deployment Guide

## 🚀 Ready for Deployment!

Your Ruvo Player has been successfully rebranded and committed to git. Here's how to deploy it:

## Step 1: Create New GitHub Repository

1. Go to GitHub and create a new repository:
    - **Name**: `ruvo-player`
    - **Description**: `Ruvo Player - IPTV player application for Ruvo Play`
    - **Visibility**: Public or Private (your choice)

## Step 2: Update Git Remote

Replace `YOUR_USERNAME` with your GitHub username/organization:

```bash
git remote set-url origin https://github.com/YOUR_USERNAME/ruvo-player.git
```

Or if you prefer SSH:

```bash
git remote set-url origin git@github.com:YOUR_USERNAME/ruvo-player.git
```

## Step 3: Push to GitHub

```bash
git push -u origin master
```

## Step 4: Deploy to Vercel

### Option A: Vercel CLI (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### Option B: Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your `ruvo-player` repository
4. Vercel will automatically detect it's an Angular project
5. Use these settings:
    - **Build Command**: `npm run build:web`
    - **Output Directory**: `dist/browser`
    - **Install Command**: `npm install`

## Step 5: Custom Domain (Optional)

If you want to use a custom domain like `player.ruvoplay.com`:

1. In Vercel dashboard, go to your project
2. Go to Settings → Domains
3. Add your custom domain
4. Update your DNS records as instructed

## 🎯 What's Included in This Deployment

### ✅ Complete Rebranding

-   **App Name**: Ruvo Player
-   **Visual Identity**: Beautiful Ruvo Play logos
-   **All Text**: Updated throughout the interface
-   **Metadata**: SEO-optimized for Ruvo Player

### ✅ Production Optimizations

-   **PWA Ready**: Works offline, installable
-   **Service Worker**: Caching for better performance
-   **Responsive Design**: Works on all devices
-   **SEO Optimized**: Proper meta tags and manifest

### ✅ All Features Working

-   **IPTV Playlist Support**: M3U, M3U8, Xtream Code
-   **EPG Support**: Electronic Program Guide
-   **Multi-language**: 16 languages supported
-   **Video Players**: HTML5, HLS.js, Video.js support
-   **Favorites**: Channel management
-   **Search**: Full-text search functionality

## 📊 Expected Performance

-   **Load Time**: ~2-3 seconds on fast connections
-   **Bundle Size**: Optimized for web delivery
-   **PWA Score**: 90+ on Lighthouse
-   **Mobile Friendly**: Fully responsive

## 🔧 Environment Variables (if needed)

If you need to configure any environment-specific settings, add them in Vercel:

1. Go to Project Settings → Environment Variables
2. Add any required variables
3. Redeploy

## 📱 Testing Your Deployment

Once deployed, test these key features:

1. **Home Screen**: Verify "Ruvo Player" branding
2. **About Dialog**: Check Ruvo Play logo appears
3. **Playlist Import**: Test M3U/Xtream functionality
4. **Video Playback**: Verify streaming works
5. **PWA**: Test "Add to Home Screen" on mobile

## 🎉 You're Ready!

Your beautifully rebranded Ruvo Player will be live and ready for users to enjoy!

The app maintains all the powerful IPTV functionality while showcasing the stunning Ruvo Play brand identity.
