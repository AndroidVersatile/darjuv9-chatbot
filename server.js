const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express().use(bodyParser.json());

const token = process.env.ACCESS_TOKEN;
const phone_number_id = process.env.PHONE_NUMBER_ID;
const verify_token = process.env.MY_SCRETE_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://www.darjuv9.com/webservice/Service.asmx';

const userState = {};
const userData = {};
const userSession = {};

// Session timeout: 5 minutes
const SESSION_TIMEOUT = 5 * 60 * 1000;

// ==========================================
// WEBHOOK VERIFICATION
// ==========================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token_sent = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token_sent === verify_token) {
        res.status(200).send(challenge);
        console.log('Webhook verified successfully');
    } else {
        res.sendStatus(403);
        console.log('Webhook verification failed');
    }
});

// ==========================================
// RECEIVING MESSAGES
// ==========================================
app.post('/webhook', async (req, res) => {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];


    if (message) {
        const from = message.from;

        // Check if user has active session
        if (userSession[from] && Date.now() - userSession[from].loginTime < SESSION_TIMEOUT) {
            // User is logged in - handle menu options
            if (message.type === 'text') {
                const msg_body = message.text.body.trim();

                // Handle Self BV inputs
                if (userState[from] === 'WAITING_FORM_NO') {
                    if (msg_body.toLowerCase() === 'cancel') {
                        await sendReply(from, "❌ Action cancelled.");
                        delete userState[from];
                        await sendMainMenu(from);
                        return;
                    }
                    if (!userData[from]) userData[from] = {};
                    userData[from].formNo = msg_body;
                    await sendReply(from, "📅 Great! Now enter FROM DATE (DD/MM/YYYY):\n\nType 'cancel' to cancel.");
                    userState[from] = 'WAITING_FROM_DATE';
                } else if (userState[from] === 'WAITING_FROM_DATE') {
                    if (msg_body.toLowerCase() === 'cancel') {
                        await sendReply(from, "❌ Action cancelled.");
                        delete userState[from];
                        await sendMainMenu(from);
                        return;
                    }
                    if (!userData[from]) userData[from] = {};
                    userData[from].fromDate = msg_body;
                    await sendReply(from, "📅 Great! Now enter TO DATE (DD/MM/YYYY):\n\nType 'cancel' to cancel.");
                    userState[from] = 'WAITING_TO_DATE';
                } else if (userState[from] === 'WAITING_TO_DATE') {
                    if (msg_body.toLowerCase() === 'cancel') {
                        await sendReply(from, "❌ Action cancelled.");
                        delete userState[from];
                        await sendMainMenu(from);
                        return;
                    }
                    if (!userData[from]) userData[from] = {};
                    userData[from].toDate = msg_body;
                    await fetchSelfBVDetails(from);
                } else if (userState[from] === 'WAITING_FORGOT_ID') {
                    if (msg_body.toLowerCase() === 'cancel') {
                        await sendReply(from, "❌ Action cancelled.");
                        delete userState[from];
                        await sendMainMenu(from);
                        return;
                    }
                    if (!userData[from]) userData[from] = {};
                    userData[from].forgotId = msg_body;
                    await sendForgotPassword(from);
                } else if (msg_body === '#') {
                    // Go back to menu
                    await sendMainMenu(from);
                } else {
                    await handleMenuSelection(from, msg_body);
                }
            }
            res.sendStatus(200);
            return;
        } else if (userSession[from]) {
            // Session expired
            delete userSession[from];
            delete userState[from];
            delete userData[from];
        }

        // Handle text messages
        if (message.type === 'text') {
            const msg_body = message.text.body.trim();

            if (userState[from] === 'WAITING_FOR_ID') {
                if (!userData[from]) userData[from] = {};
                userData[from].id = msg_body;
                await sendReply(from, "Great! 👍\n\nNow please enter your Password:");
                userState[from] = 'WAITING_FOR_PASSWORD';

            } else if (userState[from] === 'WAITING_FOR_PASSWORD') {
                await handleLogin(from, msg_body);

            } else if (['hi', 'hii', 'hello', 'hey', 'hy'].includes(msg_body.toLowerCase())) {
                await sendWelcomeMessage(from);
            } else {
                await sendReply(from, "Please type 'hi' to start the conversation.");
            }
        }

        // Handle button replies
        else if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
            const buttonId = message.interactive.button_reply.id;

            if (buttonId === 'btn_existing') {
                await sendReply(from, "Great! 😊\n\nPlease enter your ID Number:");
                userState[from] = 'WAITING_FOR_ID';

            } else if (buttonId === 'btn_new') {
                await sendRegisterButton(from, "Welcome! Please register here to get started:");
                delete userState[from];
            }
        }
    }
    res.sendStatus(200);
});

// ==========================================
// LOGIN API HANDLER
// ==========================================
async function handleLogin(from, password) {
    try {
        const userId = userData[from]?.id;
        console.log('userId', userId);

        if (!userId) {
            await sendReply(from, "Error: User ID not found. Please start again by typing 'hi'.");
            delete userState[from];
            return;
        }

        await sendReply(from, "🔄 Logging in... Please wait.");

        const apiUrl = `${BASE_URL}/LoginMember?IDNo=${userId}&Password=${password}`;
        const response = await axios.get(apiUrl);
        const data = response.data;
        console.log('login data', data);

        // Check if login successful
        if (data && data.Status === "True") {
            const userInfo = data.Data && data.Data.length > 0 ? data.Data[0] : {};

            // Store session
            userSession[from] = {
                loginTime: Date.now(),
                userId: userId,
                userInfo: userInfo
            };

            // Send success message with user details
            const welcomeMsg = `✅ *Login Successful!*\n\n${data.Message}\n\n👤 Welcome ${userInfo.MemFirstName || userInfo.Name || 'User'}!\n\n📊 *Your Details:*\n🆔 ID: ${userInfo.IDNo || userId}\n📧 Email: ${userInfo.Email || 'N/A'}\n📱 Mobile: ${userInfo.Mobl || userInfo.Mobile || 'N/A'}\n📝 Form Number: ${userInfo.FormNo || 'N/A'}\n\n⏰ Session valid for 5 minutes.`;

            await sendReply(from, welcomeMsg);

            // Show main menu
            await sendMainMenu(from);

            // Clear state
            delete userState[from];

            // Auto logout after 5 minutes
            setTimeout(() => {
                if (userSession[from]) {
                    delete userSession[from];
                    delete userData[from];
                    sendReply(from, "⏰ Your session has expired. Please type 'hi' to login again.");
                }
            }, SESSION_TIMEOUT);

        } else {
            // Login failed
            const errorMsg = data?.Message || "Invalid ID or Password";
            await sendReply(from, `❌ Login Failed!\n\n${errorMsg}\n\nPlease try again by typing 'hi'.`);
            delete userState[from];
            delete userData[from];
        }

    } catch (error) {
        console.error("Login Error:", error.message);
        await sendReply(from, "⚠️ Server error occurred. Please try again later.");
        delete userState[from];
    }
}

// ==========================================
// MAIN MENU & MENU HANDLER
// ==========================================

async function sendMainMenu(to) {
    const menuMsg = `📋 *What would you like to do?*\n\n1️⃣ View Self BV\n2️⃣ Know About Team BV\n3️⃣ Download Document Link\n4️⃣ Know About Product\n5️⃣ Know Your Payout\n6️⃣ Forget Password\n7️⃣ Logout\n\n💡 Please enter a number (1-7) to select an option.`;
    await sendReply(to, menuMsg);
}

async function handleMenuSelection(from, input) {
    const choice = input.trim();

    // Validate input is a number between 1-7
    if (!/^[1-7]$/.test(choice)) {
        await sendReply(from, "❌ Invalid option!\n\nPlease enter a number between 1 and 7.");
        await sendMainMenu(from);
        return;
    }

    switch (choice) {
        case '1':
            await showSelfBV(from);
            break;
        case '2':
            await showTeamBV(from);
            break;
        case '3':
            await showDocumentLink(from);
            break;
        case '4':
            await showProducts(from);
            break;
        case '5':
            await showPayout(from);
            break;
        case '6':
            await handleForgetPassword(from);
            break;
        case '7':
            await handleLogout(from);
            break;
    }
}

// ==========================================
// MENU OPTIONS FUNCTIONS
// ==========================================

async function showSelfBV(from) {
    await sendReply(from, "📝 *View Self BV*\n\nPlease enter your FORM NUMBER:\n\nExample: 123456\n\nType 'cancel' to cancel.");
    userState[from] = 'WAITING_FORM_NO';
}

async function fetchSelfBVDetails(from) {
    try {
        const formNo = userData[from]?.formNo;
        const fromDate = userData[from]?.fromDate;
        const toDate = userData[from]?.toDate;

        if (!formNo) {
            await sendReply(from, "❌ Error: Form Number is required.");
            delete userState[from];
            await sendMainMenu(from);
            return;
        }

        // Validate date format (basic validation)
        const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
        if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
            await sendReply(from, "❌ Invalid date format!\n\nPlease use DD/MM/YYYY format.\n\nExample: 12/02/2026");
            delete userState[from];
            await sendMainMenu(from);
            return;
        }

        await sendReply(from, "🔄 Fetching your Self BV details... Please wait.");

        const apiUrl = `${BASE_URL}/SelfPVDetails?FormNo=${formNo}&FromDate=${fromDate}&ToDate=${toDate}`;
        console.log('Self BV API URL:', apiUrl);

        const response = await axios.get(apiUrl);
        const data = response.data;
        console.log('Self BV Response:', data);

        if (data && data.Status === "True") {
            const bvData = data.Data && data.Data.length > 0 ? data.Data : [];

            if (bvData.length === 0) {
                await sendReply(from, `📄 *Self BV Report*\n\n📅 Period: ${fromDate} to ${toDate}\n📝 Form No: ${formNo}\n\nℹ️ No records found for this date range.`);
            } else {
                let reportMsg = `📊 *Self BV Report*\n\n📅 Period: ${fromDate} to ${toDate}\n📝 Form No: ${formNo}\n\n`;

                // Display BV details
                bvData.forEach((item, index) => {
                    reportMsg += `📌 Record ${index + 1}:\n`;
                    reportMsg += `Date: ${item.Date || 'N/A'}\n`;
                    reportMsg += `BV: ${item.BV || '0.00'}\n`;
                    reportMsg += `Amount: ₹${item.Amount || '0.00'}\n`;
                    reportMsg += `\n`;
                });

                await sendReply(from, reportMsg);
            }
        } else {
            const errorMsg = data?.Message || "Unable to fetch BV details";
            await sendReply(from, `❌ ${errorMsg}\n\nPlease try again later.\n\nPress # to go back to menu.`);
        }

        // Clear state and show menu
        delete userState[from];
        await sendReply(from, "\n\nPress # to go back to menu.");

    } catch (error) {
        console.error("Self BV Error:", error.message);
        await sendReply(from, "⚠️ Server error occurred while fetching BV details.\n\nPlease try again later.\n\nPress # to go back to menu.");
        delete userState[from];
    }
}

async function showTeamBV(from) {
    const teamMsg = `👥 *Team BV Summary*\n\n⬅️ Left Team BV: 2,601.00\n➡️ Right Team BV: 1,850.00\n📦 Total Team BV: 4,451.00\n\n👤 Active Members: 15\n🆕 New Joinings: 3\n🎯 Team Target: 10,000.00\n\nPress # to go back to menu.`;
    await sendReply(from, teamMsg);
}

async function showDocumentLink(from) {
    const docMsg = `📄 *Download Documents*\n\n1. ID Card\n2. Certificate\n3. Tax Documents\n4. Agreement Copy\n5. Product Catalog\n\nPress # to go back to menu.`;
    await sendReply(from, docMsg);
    await sendDocumentLinkButton(from);
}

async function showProducts(from) {
    const productMsg = `🛍️ *Our Products*\n\n1. *Health Supplement A*\n   💰 Price: ₹1,500\n   📦 BV: 50\n\n2. *Wellness Pack B*\n   💰 Price: ₹3,000\n   📦 BV: 120\n\n3. *Premium Kit C*\n   💰 Price: ₹5,000\n   📦 BV: 200\n\n✨ All products are 100% natural and certified!\n\nPress # to go back to menu.`;
    await sendReply(from, productMsg);
}

async function showPayout(from) {
    try {
        const userInfo = userSession[from]?.userInfo || {};
        const FormNo = userInfo.FormNo;

        if (!FormNo) {
            await sendReply(from, "❌ Error: Form Number not found in your profile.\n\nPlease contact support.");
            await sendMainMenu(from);
            return;
        }

        await sendReply(from, "🔄 Fetching your payout details... Please wait.");

        const apiUrl = `${BASE_URL}/WeeklyPayout?FormNo=${FormNo}`;
        console.log('Payout API URL:', apiUrl);

        const response = await axios.get(apiUrl);
        const data = response.data;
        console.log('Payout Response:', data);

        if (data && data.Status === "True") {
            const payoutData = data.Data && data.Data.length > 0 ? data.Data : [];

            if (payoutData.length === 0) {
                await sendReply(from, `💵 *Your Payout Details*\n\n📝 Form No: ${formNo}\n\nℹ️ No payout records found.`);
            } else {
                let payoutMsg = `💵 *Your Payout Details*\n\n📝 Form No: ${formNo}\n\n`;

                // Display payout details
                payoutData.forEach((item, index) => {
                    payoutMsg += `📌 Payout ${index + 1}:\n`;
                    payoutMsg += `Week: ${item.Week || 'N/A'}\n`;
                    payoutMsg += `Date: ${item.Date || 'N/A'}\n`;
                    payoutMsg += `Amount: ₹${item.Amount || '0.00'}\n`;
                    payoutMsg += `Status: ${item.Status || 'N/A'}\n`;
                    payoutMsg += `\n`;
                });

                await sendReply(from, payoutMsg);
            }
        } else {
            const errorMsg = data?.Message || "Unable to fetch payout details";
            await sendReply(from, `❌ ${errorMsg}\n\nPlease try again later.\n\nPress # to go back to menu.`);
        }

        await sendMainMenu(from);

    } catch (error) {
        console.error("Payout Error:", error.message);
        await sendReply(from, "⚠️ Server error occurred while fetching payout details.\n\nPlease try again later.\n\nPress # to go back to menu.");
    }
}

async function handleForgetPassword(from) {
    await sendReply(from, "🔐 *Forget Password*\n\n*Please enter your ID NUMBER:*\n\nExample: 0001XXXXXXX\n\nType 'cancel' to cancel.");
    userState[from] = 'WAITING_FORGOT_ID';
}

async function sendForgotPassword(from) {
    try {
        const idNo = userData[from]?.forgotId;
        const deviceId = from; // WhatsApp number as device ID

        if (!idNo) {
            await sendReply(from, "❌ Error: ID Number is required.");
            delete userState[from];
            await sendMainMenu(from);
            return;
        }

        await sendReply(from, "🔄 Sending password reset request... Please wait.");

        const apiUrl = `${BASE_URL}/ForgotPassword?IDNo=${idNo}&DeviceID=${deviceId}`;
        console.log('Forgot Password API URL:', apiUrl);

        const response = await axios.get(apiUrl);
        const data = response.data;
        console.log('Forgot Password Response:', data);

        if (data && data.Status === "True") {
            await sendReply(from, `✅ ${data.Message || 'Password reset request sent successfully!'}\n\nPlease check your registered mobile/email.\n\nPress # to go back to menu.`);
        } else {
            const errorMsg = data?.Message || "Unable to process password reset request";
            await sendReply(from, `❌ ${errorMsg}\n\nPlease try again later.\n\nPress # to go back to menu.`);
        }

        delete userState[from];

    } catch (error) {
        console.error("Forgot Password Error:", error.message);
        await sendReply(from, "⚠️ Server error occurred while processing your request.\n\nPlease try again later.\n\nPress # to go back to menu.");
        delete userState[from];
    }
}

async function handleLogout(from) {
    delete userSession[from];
    delete userData[from];
    await sendReply(from, "👋 *Logged Out Successfully!*\n\nThank you for using our service.\n\nType 'hi' to login again.");
}

async function sendDocumentLinkButton(to) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "cta_url",
                body: { text: "Click below to access all documents:" },
                action: {
                    name: "cta_url",
                    parameters: {
                        display_text: "Download Documents",
                        url: "https://www.darjuv9.com/documents"
                    }
                }
            }
        }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
        console.error("Document Link Error:", error.message);
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function sendWelcomeMessage(to) {
    await sendButtons(to, "👋 Welcome to Darjuv9 Bot!\n\nAre you an existing user or a new user?", [
        { id: "btn_existing", title: "Existing User" },
        { id: "btn_new", title: "New User" }
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
    } catch (error) {
        console.error("Button Error:", error.response?.data || error.message);
    }
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
                    parameters: {
                        display_text: "Register Here",
                        url: "https://www.darjuv9.com/JoiningForm2024/Memberjoining_New_Update.aspx"
                    }
                }
            }
        }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
        console.error("URL Button Error:", error.message);
    }
}

async function sendReply(to, text) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
            messaging_product: "whatsapp",
            to: to,
            text: { body: text },
        }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
        console.error("Text Error:", error.message);
    }
}

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
    console.log(`📱 WhatsApp Bot is ready!`);
});
