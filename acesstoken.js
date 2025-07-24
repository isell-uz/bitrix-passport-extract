import express from 'express';

const app = express();
const PORT = 3030;

// --- CONFIGURATION: Replace with your values ---
const B24_PORTAL = 'https://isell.bx24.uz'; // Your portal URL
const CLIENT_ID = 'local.6863b9b32d2411.07032005';   // Your app's Client ID
const CLIENT_SECRET = '5nzG6dFbWKnDjHm5uCkERCWGrMmipttZLaA6gOo5ts3Q2jqZwz';
const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`;

// 1. STARTING POINT: This route begins the authentication process
app.get('/start-auth', (req, res) => {
    // We construct the authorization URL and redirect the user to Bitrix24
    const authUrl = `${B24_PORTAL}/oauth/authorize/?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;

    console.log(authUrl)
    console.log('Redirecting user to Bitrix24 for authorization...');

    res.redirect(authUrl);
});

// 2. CALLBACK HANDLER: Bitrix24 redirects the user here after they approve
app.get('/oauth-callback', async (req, res) => {
    const temporaryCode = req.query.code;

    if (!temporaryCode) {
        return res.status(400).send('Error: Could not get temporary code from Bitrix24.');
    }

    console.log(`Received temporary code: ${temporaryCode}`);

    // 3. TOKEN EXCHANGE: Make a server-to-server request to get the token
    const tokenUrl = `${B24_PORTAL}/oauth/token/`;
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('code', temporaryCode);

    try {
        console.log('SUCCESS! Tokens received.');

        console.log(tokenUrl, params)

        res.json({
            message: "Authentication successful! Tokens received.",
        });

    } catch (error) {
        console.error('Error exchanging code for token:', error.response ? error.response.data : error.message);
        res.status(500).send('Failed to get access token.');
    }
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('---');
    console.log(`To start the authentication process, open this URL in your browser:`);
    console.log(`http://localhost:${PORT}/start-auth`);
    console.log('---');
});


// for refresh token
// https://oauth.bitrix24.tech/oauth/token/?
//     grant_type=refresh_token
//     &client_id=local.6863b9b32d2411.07032005
//     &client_secret=5nzG6dFbWKnDjHm5uCkERCWGrMmipttZLaA6gOo5ts3Q2jqZwz
//     &refresh_token=7ecf8c680079ee8c00794bcb0000000800000703f9aa38b3b3befc65b5875d81891a86


//https://isell.bx24.uz/oauth/authorize/?client_id=local.6863b9b32d2411.07032005&response_type=code
