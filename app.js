import express from 'express';
import dotenv from 'dotenv';
import bitrixWebhook from "./bitrix-webhook.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({extended: true}));


app.post('/bitrix-webhook', bitrixWebhook);

app.get('/callback', async (req, res) => {
    try {
        console.log(req)
        res.status(200).json(req.params);

    } catch (error) {
        console.error('Error processing webhook:', error);
        // Still respond with success to avoid webhook retries
        res.status(200).json({success: true, error: error.message});
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});