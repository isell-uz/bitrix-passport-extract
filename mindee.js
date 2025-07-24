import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";

/**
 * Mindee API Client for document processing
 */
class MindeeClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = "https://api-v2.mindee.net/v2";
        this.headers = {
            "Authorization": apiKey
        };
    }

    /**
     * Process a file using Mindee API with polling
     * @param {string|Buffer} fileInput - File path or Buffer containing file data
     * @param {string} modelId - Mindee model ID
     * @param {Object} options - Configuration options
     * @param {string} options.fileName - Required when using Buffer (e.g., 'document.pdf')
     * @param {number} options.maxRetries - Maximum polling attempts (default: 30)
     * @param {number} options.pollingInterval - Polling interval in seconds (default: 2)
     * @param {number} options.initialDelay - Initial delay before polling in ms (default: 3000)
     * @param {boolean} options.rag - Enable RAG processing (default: false)
     * @returns {Promise<Object>} - Processed document data
     */
    async processFile(fileInput, modelId, options = {}) {
        const {
            fileName,
            maxRetries = 30,
            pollingInterval = 2,
            initialDelay = 3000,
            rag = false
        } = options;

        try {
            // Validate input
            if (Buffer.isBuffer(fileInput) && !fileName) {
                throw new Error('fileName is required when using Buffer input');
            }

            if (typeof fileInput === 'string' && !fs.existsSync(fileInput)) {
                throw new Error(`File not found: ${fileInput}`);
            }

            // Enqueue the file for processing
            const jobData = await this._enqueueFile(fileInput, modelId, rag, fileName);

            // Wait initial delay before polling
            await this._delay(initialDelay);

            // Poll for results
            const result = await this._pollForResults(
                jobData.polling_url,
                maxRetries,
                pollingInterval
            );

            return result;
        } catch (error) {
            throw new Error(`Mindee API error: ${error.message}`);
        }
    }

    /**
     * Enqueue a file for processing
     * @private
     */
    async _enqueueFile(fileInput, modelId, rag, fileName) {
        const formData = new FormData();

        formData.append("model_id", modelId);
        formData.append("rag", rag.toString());

        if (Buffer.isBuffer(fileInput)) {
            // Handle Buffer input
            console.log(`Enqueuing buffer as file: ${fileName}`);
            formData.append("file", fileInput, {
                filename: fileName
            });
        } else {
            // Handle file path input
            const actualFileName = fileName || path.basename(fileInput);
            console.log(`Enqueuing file: ${fileInput}`);
            formData.append("file", fs.createReadStream(fileInput), {
                filename: actualFileName
            });
        }

        const response = await axios.post(
            `${this.baseUrl}/inferences/enqueue`,
            formData,
            {
                headers: { ...this.headers, ...formData.getHeaders() }
            }
        );

        return response.data.job;
    }

    /**
     * Poll for processing results
     * @private
     */
    async _pollForResults(pollingUrl, maxRetries, pollingInterval) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            console.log(`Polling attempt ${attempt + 1}/${maxRetries}: ${pollingUrl}`);

            const pollResponse = await axios.get(pollingUrl, {
                headers: this.headers,
                maxRedirects: 0,
                validateStatus: status => status >= 200 && status < 400
            });

            const pollData = pollResponse.data;
            const jobStatus = pollData.job?.status;

            // Check if processing is complete
            if (pollResponse.status === 302 || jobStatus === "Processed") {
                const resultUrl = pollData.job?.result_url;
                console.log(`Processing complete. Getting result from: ${resultUrl}`);

                const resultResponse = await axios.get(resultUrl, {
                    headers: this.headers
                });

                return resultResponse.data;
            }

            // Check for failed status
            if (jobStatus === "Failed" || jobStatus === "Error") {
                throw new Error(`Job failed with status: ${jobStatus}`);
            }

            // Wait before next poll
            await this._delay(pollingInterval * 1000);
        }

        throw new Error(`Polling timed out after ${maxRetries} attempts`);
    }

    /**
     * Simple delay helper
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get job status without processing results
     * @param {string} pollingUrl - Polling URL from enqueue response
     * @returns {Promise<Object>} - Job status data
     */
    async getJobStatus(pollingUrl) {
        const response = await axios.get(pollingUrl, {
            headers: this.headers,
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        });

        return response.data;
    }
}

/**
 * Convenience function for quick file processing
 * @param {string|Buffer} fileInput - File path or Buffer containing file data
 * @param {string} modelId - Mindee model ID
 * @param {string} apiKey - API key
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processed document data
 */
async function processDocument(fileInput, modelId, apiKey, options = {}) {
    const client = new MindeeClient(apiKey);
    return await client.processFile(fileInput, modelId, options);
}

export {
    MindeeClient,
    processDocument
};
