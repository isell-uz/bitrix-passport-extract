import axios from "axios"
import dotenv from "dotenv";
import {Bitrix} from "@2bad/bitrix";
import {latinToCyrillic} from "lotin-kirill";
import {processDocument} from "./mindee.js";

dotenv.config();

//  Config
const BITRIX_DOMAIN = process.env.BITRIX_DOMAIN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const MINDEE_MODEL_ID = process.env.MINDEE_MODEL_ID;
const MINDEE_API_KEY = process.env.MINDEE_API_KEY;

const bitrix = Bitrix(WEBHOOK_URL);

//  OAuth helpers
let cachedToken;
let tokenExpiresAt = 0;

async function fetchAccessToken() {
    if (Date.now() < tokenExpiresAt && cachedToken) {
        console.log('Cached token used')
        return cachedToken // still valid
    }

    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.BITRIX_CLIENT_ID,
        client_secret: process.env.BITRIX_CLIENT_SECRET,
        refresh_token: process.env.BITRIX_REFRESH_TOKEN,
    });

    const {data} = await axios.post('https://oauth.bitrix24.tech/oauth/token/', params);

    console.log('New token received')

    cachedToken = data.access_token;

    console.log('Refresh token data', data)

    // Bitrix tokens last ~30min; subtract 60s for safety
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
}

//  File helpers
async function buildFileUrl(downloadPath) {
    if (downloadPath.includes('auth=')) return `https://${BITRIX_DOMAIN}${downloadPath}`;

    const token = await fetchAccessToken();
    const sep = downloadPath.includes('?') ? '&' : '?';
    return `https://${BITRIX_DOMAIN}${downloadPath}${sep}auth=${token}`;
}

async function downloadFile(downloadPath) {
    const url = await buildFileUrl(downloadPath);
    console.info('Downloading:', url);

    const {data} = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30_000,
    });

    return data; // Buffer type
}

function extractPINFLFromMRZ(mrzLine2) {
    if (!mrzLine2) return '';

    if (mrzLine2.length < 16) {
        return null
    }

    return mrzLine2.slice(-16, -2);
}

//  Mindee helpers
async function parsePassport(buffer) {
    const result = await processDocument(
        buffer,
        MINDEE_MODEL_ID,
        MINDEE_API_KEY,
        {
            fileName: "document.jpg",
            maxRetries: 30,
            pollingInterval: 2,
        }
    );

    console.log("Document processed:", result.inference.result.fields);

    return result.inference.result.fields
}

// Get stage id by name
async function getStatusIdByName(statusName) {
    try {
        const {result: statuses} = await bitrix.call('crm.status.list', {
            filter: {
                ENTITY_ID: 'STATUS'
            }
        });

        if (statuses && statuses.length > 0) {
            for (const status of statuses) {
                if (status.NAME === statusName) {
                    return status.STATUS_ID;
                }
            }
        }

        console.warn(`Status with name "${statusName}" not found`);
        return null;
    } catch (error) {
        console.error('Error fetching status:', error);
        return null;
    }
}

const bitrixWebhook = async function (req, res) {
    try {
        const [, , leadRef] = req.body.document_id || [];
        const leadId = leadRef?.replace('LEAD_', '');

        if (!leadId) {
            return res.status(400).json({success: false, error: 'Lead ID not found'});
        }

        const {result: lead} = await bitrix.call('crm.lead.get', {
            id: leadId,
            select: ['*'],
        });

        console.info('Processing lead 🆕🆕🆕🆕', leadId);
        console.info('Lead TITLE: ', lead.TITLE);

        const passportFiles = lead?.UF_CRM_1732877852 ?? [];

        // Initialize with empty values instead of undefined
        const passportDetails = {
            documentNumber: '',
            issueDate: '',
            pinfl: '',
            surname: '',
            name: '',
            patronymic: '',
            birthDate: '',
            birthPlace: '',
            mrz: ''
        };

        for (const {id: fileId, showUrl} of passportFiles) {
            try {
                const buffer = await downloadFile(showUrl);
                const prediction = await parsePassport(buffer);

                if (prediction.document_type?.value === 'Passport') {
                    const passportData = {
                        documentNumber: prediction.document_number.value || '',
                        issueDate: prediction.date_of_issue.value || '',
                        pinfl: extractPINFLFromMRZ(prediction.mrz_lines.value) || '',
                        surname: prediction.surnames?.value || '',
                        name: prediction.given_names?.value || '',
                        patronymic: prediction.patronymic.value || '',
                        birthDate: prediction.date_of_birth.value || '',
                        birthPlace: prediction.place_of_birth.value || '',
                        mrz: prediction.mrz.value || ''
                    };

                    // Only update if we have a value
                    Object.keys(passportData).forEach(key => {
                        if (passportData[key] && !passportDetails[key]) {
                            passportDetails[key] = passportData[key];
                        }
                    });

                    break;
                } else if (prediction.document_type?.value === 'National ID') {

                    let date_of_birth = null
                    let documentNumber = null
                    let date_of_issue = null

                    // only get birth_date and document_number if its front side
                    if (prediction.patronymic.value) {
                        console.log('FRONT SIDE 🙌🙌🙌🙌🙌🙌')
                        date_of_birth = prediction.date_of_birth.value
                        documentNumber = prediction.document_number.value
                        date_of_issue = prediction.date_of_issue.value
                    }

                    const idCardData = {
                        documentNumber: passportDetails.document_number || documentNumber,
                        issueDate: passportDetails.date_of_issue || date_of_issue,
                        pinfl: passportDetails.pinfl || prediction.personal_number.value,
                        surname: passportDetails.surname || prediction.surnames?.value,
                        name: passportDetails.name || prediction.given_names?.value,
                        patronymic: passportDetails.patronymic || prediction.patronymic.value,
                        birthDate: passportDetails.date_of_birth || date_of_birth,
                        birthPlace: passportDetails.place_of_birth || prediction.place_of_birth.value,
                        mrz: prediction.mrz.value || ''
                    };

                    // Only update if we have a value
                    Object.keys(idCardData).forEach(key => {
                        if (idCardData[key] && !passportDetails[key]) {
                            passportDetails[key] = idCardData[key];
                        }
                    });
                } else {
                    console.log('Not a PASSPORT or ID CARD !!!')
                }

                // Check if all passport data filled
                const missingFields = Object.entries(passportDetails)
                    .filter(([key, value]) => !value)
                    .map(([key]) => key);

                if (missingFields.length === 0) {
                    console.log('All the data has been filled');
                    break;
                }

            } catch (fileErr) {
                console.error(`Error for file ${fileId}:`, fileErr);
            }
        }

        // Check passport fields
        const missingFields = Object.entries(passportDetails)
            .filter(([key, value]) => !value)
            .map(([key]) => key);

        if (missingFields.length > 0) {
            if (!passportFiles.length) {
                console.log('No passport images were found');
            } else {
                console.log('Final missing passport fields:', missingFields.join(', '));
            }

            const statusId = await getStatusIdByName('Паспорт нотўғри');

            if (statusId) {
                await bitrix.call('crm.lead.update', {
                    id: leadId,
                    fields: {
                        'STATUS_ID': statusId,
                    }
                });
            } else {
                console.error('Could not find status "Паспорт нотўғри"');
            }

        } else {
            console.log('All passport fields are filled successfully', passportDetails);

            const statusId = await getStatusIdByName('Паспорт тўғри');

            console.log('status id', statusId)

            if (statusId) {
                // Map passport data to Bitrix custom fields
                const updateFields = {
                    // Серия паспорта (Passport Series) - Document Number
                    'UF_CRM_1732958516635': passportDetails.documentNumber,

                    // Дата выдачи паспорта (Passport Issue Date)
                    'UF_CRM_1739861061211': passportDetails.issueDate,

                    // ПИНФЛ (Personal Number from MRZ Line 2)
                    'UF_CRM_1737176296854': passportDetails.pinfl,

                    // Имя (Given Names)
                    'NAME': latinToCyrillic(passportDetails.name),

                    // Фамилия (Surnames)
                    'LAST_NAME': latinToCyrillic(passportDetails.surname),

                    // Дата рождения (Birth Date)
                    'BIRTHDATE': passportDetails.birthDate,

                    // Место рождения (Birth Place)
                    'UF_CRM_1737177490340': latinToCyrillic(passportDetails.birthPlace),

                    'STATUS_ID': statusId,

                    'SECOND_NAME': latinToCyrillic(passportDetails.patronymic),

                    'UF_CRM_1771497129503': passportDetails.mrz
                };

                await bitrix.call('crm.lead.update', {
                    id: leadId,
                    fields: updateFields
                });

                console.log('Lead updated successfully');
            } else {
                console.error('Could not find status "Паспорт тўғри"');
            }
        }

        console.log('End of processing 🔚🔚🔚🔚🔚🔚')
        console.log('----------------------------------')
        res.json({success: true});
    } catch (err) {
        console.error('Webhook handler error:', err);
        res.json({success: true, error: err.message});
    }
};

export default bitrixWebhook;
