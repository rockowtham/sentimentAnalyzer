# Nifty 50 Closes Browser Extension

A Chrome extension that fetches closing prices for up to 10 Nifty 50 stocks using the Upstox API.

## Prerequisites

1. **Upstox Developer Account**: You need an Upstox account with API access
2. **Access Token**: Get your Upstox API access token from the [Developer Console](https://account.upstox.com/developer/apps)
3. **Chrome Browser**: This extension works with Chrome/Chromium-based browsers

## Installation

### Step 1: Load the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `browser_plugin` folder (`/Users/gsjk/code/tsai/browser_plugin`)
5. The extension should now appear in your extensions list

### Step 2: Configure the Extension

1. Click the extension icon in your browser toolbar
2. Click **"Options"** to open the settings page
3. Enter your **Upstox Access Token** (the Bearer token from your Upstox API)
4. Enter up to 10 **Instrument Keys** (comma-separated). Example:
   ```
   NSE_EQ|INE002A01018, NSE_EQ|INE467B01029, NSE_EQ|INE040A01034, NSE_EQ|INE009A01021, NSE_EQ|INE030A01027, NSE_EQ|INE090A01021, NSE_EQ|INE237A01028, NSE_EQ|INE062A01020, NSE_EQ|INE296A01024, NSE_EQ|INE018A01030
   ```
5. Click **"Save"**

### Step 3: Use the Extension

1. Click the extension icon in your browser toolbar
2. Click **"Refresh"** to fetch the latest closing prices
3. The popup will display each stock symbol with its latest daily close price

## Getting Your Upstox Access Token

1. Go to [Upstox Developer Console](https://account.upstox.com/developer/apps)
2. Create a new app or use an existing one
3. Generate your API credentials
4. Use the OAuth flow to get an access token
5. Copy the Bearer token (without the "Bearer " prefix)

## Instrument Keys Format

The extension expects instrument keys in the format: `EXCHANGE|SYMBOL`

Common formats:
- `NSE_EQ|RELIANCE` (NSE Equity)
- `BSE_EQ|RELIANCE` (BSE Equity)

You can find the correct instrument keys in your Upstox API documentation or by calling their instruments API.

## Troubleshooting

### "Missing Upstox access token"
- Make sure you've entered your access token in the Options page
- Verify the token is valid and has market data permissions

### "No instrument keys configured"
- Add instrument keys in the Options page
- Use the correct format: `EXCHANGE|SYMBOL`

### API Errors
- Check that your access token is valid and not expired
- Verify the instrument keys are correct
- Ensure your Upstox account has market data access

### Extension Not Loading
- Make sure Developer mode is enabled in Chrome
- Check that all files are in the correct directory structure
- Reload the extension if you make changes to the code

## File Structure

```
browser_plugin/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for API calls
├── popup.html            # Extension popup UI
├── popup.js              # Popup functionality
├── options.html          # Settings page
├── options.js            # Settings functionality
└── README.md             # This file
```

## Development

To modify the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Test your changes

## API Endpoint Used

The extension calls:
```
GET https://api.upstox.com/v2/market-quote/ohlc?instrument_key=<keys>&interval=day
Authorization: Bearer <your_token>
```

This fetches daily OHLC data and extracts the closing prices for display.
