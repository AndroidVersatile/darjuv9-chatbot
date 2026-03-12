    const express = require('express');
    const axios = require('axios');
    const bodyParser = require('body-parser');
    require('dotenv').config();

    const app = express().use(bodyParser.json());

    const token = process.env.ACCESS_TOKEN;
    const phone_number_id = process.env.PHONE_NUMBER_ID;
    const verify_token = "my_secret_token_123";

    // User states: 'WAITING_FOR_NUMBER', 'WAITING_FOR_ID', 'WAITING_FOR_PASSWORD', 'WAITING_FOR_FORGOT_ID'
    const userState = {}; 
    const userData = {}; 

    // 1. Webhook Verification
    app.get('/webhook', (req, res) => {
        const mode = req.query['hub.mode'];
        const token_sent = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token_sent === verify_token) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    });

    // 2. Receiving Messages & Logic
    app.post('/webhook', async (req, res) => {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (message) {
            const from = message.from;

            if (message.type === 'text') {
                const msg_body = message.text.body.trim();

                if (userState[from] === 'WAITING_FOR_NUMBER') {
                    await verifyMobileAPI(from, msg_body);

                } else if (userState[from] === 'WAITING_FOR_ID') {
                    userData[from] = { id: msg_body }; 
                    await verifyAssociatedId(from, msg_body);

                } else if (userState[from] === 'WAITING_FOR_PASSWORD') {
                    // Maan lijiye abhi hardcoded password "1234" hai
                    if (msg_body === "1234") { 
                        await sendReply(from, "Login Successful! 🎉 Welcome Kuldeep Mathur.");
                        
                        // Dashboard message as per your screenshot
                        const dashboardMsg = `📊 *Your Dashboard Summary*\n\n👤 ID: ${userData[from]?.id || 'N/A'}\n💰 Self BV: 0.00\n⬅️ Left BV: 2601.00\n➡️ Right BV: 0.00\n📦 GBV: 2601.00\n📈 TBV: 2601.00`;
                        await sendReply(from, dashboardMsg);
                        delete userState[from];
                    } else {
                        await sendPasswordErrorOptions(from);
                    }

                } else if (userState[from] === 'WAITING_FOR_FORGOT_ID') {
                    await handleForgotPasswordAPI(from, msg_body);

                } else if (['hi', 'hii', 'hello', 'hy'].includes(msg_body.toLowerCase())) {
                    await sendWelcomeOptions(from);
                }
            } 
            
            else if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
                const buttonId = message.interactive.button_reply.id;

                if (buttonId === 'btn_existing') {
                    await sendReply(from, "Please enter your registered number:");
                    userState[from] = 'WAITING_FOR_NUMBER'; 
                    
                } else if (buttonId === 'btn_try_again') {
                    await sendReply(from, "Please enter your password again:");
                    userState[from] = 'WAITING_FOR_PASSWORD';

                } else if (buttonId === 'btn_new') {
                    await sendRegisterButton(from, "Welcome! Please register here:");
                    delete userState[from];

                } else if (buttonId === 'btn_forgot_pw') {
                    await sendReply(from, "Please enter your User ID for password recovery:");
                    userState[from] = 'WAITING_FOR_FORGOT_ID';
                }
            }
        }
        res.sendStatus(200);
    });

    // ==========================================
    // API LOGIC (Updated with Error Logs)
    // ==========================================

    async function verifyMobileAPI(from, mobileNumber) {
        try {
            const apiUrl = `http://www.darjuv9.com/webservice/Service.asmx/VerificationMobileNo?RegistrationMobileNo=${mobileNumber}&DeviceMobileNo=${mobileNumber}&IMEINo=&ConnectThru=&OperatorName=&OperatorCountry=&SIMSerialNo=&SIMSubscriberId=&SIMIMEINo=&HType=&vrsion=&DeviceModel=&DeviceName=`;
            const response = await axios.get(apiUrl, { timeout: 10000 });
            const data = response.data[0]; 

            if (data && data.Status === "true") {
                await sendReply(from, "User successfully verified! ✅\nPlease enter your associated ID:");
                userState[from] = 'WAITING_FOR_ID'; 
            } else {
                await sendReply(from, "This number does not exist in our database.");
                delete userState[from];
            }
        } catch (e) { 
            console.error("Mobile API Error:", e.message);
            await sendReply(from, "⚠️ Server not responding. Please try again later."); 
        }
    }

    async function verifyAssociatedId(from, idString) {
        try {
            const apiUrl = `http://www.darjuv9.com/webservice/Service.asmx/CheckPlaceUplinerId?PlaceUplinerId=${idString}`;
            const response = await axios.get(apiUrl, { timeout: 10000 });
            const data = response.data[0]; 

            if (data && data.Status === "true") {
                await sendReply(from, `ID verified: ${data.MemName} 🎉\nPlease enter your password:`);
                userState[from] = 'WAITING_FOR_PASSWORD';
            } else {
                await sendReply(from, "Invalid ID. Please check and try again.");
                delete userState[from];
            }
        } catch (e) { 
            console.error("ID API Error:", e.message);
            await sendReply(from, "⚠️ Server error while verifying ID."); 
        }
    }

    async function handleForgotPasswordAPI(from, userId) {
        try {
            const apiUrl = `http://www.darjuv9.com/webservice/Service.asmx/ForgotPassword?IDNo=${userId}&DeviceID=${from}`;
            const response = await axios.get(apiUrl);
            const data = response.data[0];

            if (data && data.Status === "True") {
                await sendReply(from, `📩 ${data.Message}`); 
                await sendReply(from, "Now enter the password you received:");
                userState[from] = 'WAITING_FOR_PASSWORD'; 
            } else {
                await sendReply(from, "Recovery failed. ID not found.");
                delete userState[from];
            }
        } catch (e) { 
            console.error("Forgot PW API Error:", e.message);
            await sendReply(from, "⚠️ Recovery service is currently down."); 
        }
    }

    // ==========================================
    // WHATSAPP HELPERS
    // ==========================================

    async function sendWelcomeOptions(to) {
        await sendButtons(to, "Welcome to Darjuv9 Bot! Are you an existing or new user?", [
            { id: "btn_existing", title: "Existing User" },
            { id: "btn_new", title: "New User" }
        ]);
    }

    async function sendPasswordErrorOptions(to) {
        await sendButtons(to, "Incorrect Password! ❌\nKya aap dobara koshish karna chahte hain?", [
            { id: "btn_try_again", title: "Try Again" },
            { id: "btn_forgot_pw", title: "Forgot Password" }
        ]);
    }

    async function sendButtons(to, text, buttons) {
        try {
            await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: { text: text },
                    action: { 
                        buttons: buttons.map(b => ({ 
                            type: "reply", 
                            reply: { id: b.id, title: b.title.substring(0, 20) }
                        })) 
                    }
                }
            }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e) { console.error("Button Error:", e.response?.data || e.message); }
    }

    async function sendRegisterButton(to, messageText) {
        try {
            await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "cta_url",
                    body: { text: messageText },
                    action: {
                        name: "cta_url",
                        parameters: { display_text: "Register Here", url: "https://www.darjuv9.com/JoiningForm2024/Memberjoining_New_Update.aspx" }
                    }
                }
            }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e) { console.error("URL Button Error"); }
    }

    async function sendReply(to, text) {
        try {
            await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: to,
                text: { body: text },
            }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e) { console.error("Text Error:", e.response?.data || e.message); }
    }

    app.listen(3000, () => console.log('Server is listening on port 3000'));