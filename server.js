const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express().use(bodyParser.json());

const token = process.env.ACCESS_TOKEN;
const phone_number_id = process.env.PHONE_NUMBER_ID;
const verify_token = process.env.MY_SCRETE_TOKEN;

const userState = {};
const userData = {};
if (!token || !phone_number_id) {
    console.warn("Missing META_ACCESS_TOKEN or PHONE_NUMBER_ID in environment.");
}
// 1. Webhook Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token_sent = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token_sent === verify_token) {
        res.status(200).send(challenge);
        console.log('Connected');

    } else {
        res.sendStatus(403);
        console.log('Not Connected');
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
                // Maan lijiye password "1234" hai
                if (msg_body === "1234") {
                    // Login Success! Ab dashboard data dikhayenge
                    await sendReply(from, "Login Successful! 🎉 Welcome Kuldeep Mathur.");
                    // Yahan hum dashboard ka summary bhej rahe hain
                    const dashboardMsg = `📊 *Your Dashboard Summary*\n\n👤 ID: ${userData[from]?.id || 'N/A'}\n💰 Self BV: 0.00\n⬅️ Left BV: 2601.00\n➡️ Right BV: 0.00\n📦 GBV: 2601.00`;
                    await sendReply(from, dashboardMsg);
                    // Show main menu after login
                    await sendMainMenu(from);
                    userState[from] = 'LOGGED_IN_MENU';
                } else {
                    await sendPasswordErrorOptions(from);
                }

            } else if (userState[from] === 'LOGGED_IN_MENU') {
                await handleMainMenuSelection(from, msg_body);

            } else if (userState[from] === 'WAITING_FROM_DATE') {
                if (!userData[from]) userData[from] = {};
                userData[from].fromDate = msg_body;
                await sendReply(from, "Please enter TO DATE (DD/MM/YYYY):");
                userState[from] = 'WAITING_TO_DATE';

            } else if (userState[from] === 'WAITING_TO_DATE') {
                if (!userData[from]) userData[from] = {};
                userData[from].toDate = msg_body;
                await sendBVDateOptions(from);
                userState[from] = 'BV_DATE_SELECTED';

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
                // FIX: Ab ye seedha password maangega
                await sendReply(from, "Please enter your password again:");
                userState[from] = 'WAITING_FOR_PASSWORD';

            } else if (buttonId === 'btn_new') {
                await sendRegisterButton(from, "Welcome! Please register here:");
                delete userState[from];

            } else if (buttonId === 'btn_forgot_pw') {
                await sendReply(from, "Please enter your User ID for password recovery:");
                userState[from] = 'WAITING_FOR_FORGOT_ID';

            } else if (buttonId === 'menu_1' || buttonId === 'menu_view_bv') {
                await sendReply(from, "Please enter FROM DATE (DD/MM/YYYY):");
                userState[from] = 'WAITING_FROM_DATE';

            } else if (buttonId === 'menu_2' || buttonId === 'menu_team_bv') {
                await showTeamBV(from);

            } else if (buttonId === 'menu_3' || buttonId === 'menu_documents') {
                await showDocuments(from);

            } else if (buttonId === 'menu_4' || buttonId === 'menu_products') {
                await showProducts(from);

            } else if (buttonId === 'menu_5' || buttonId === 'menu_payout') {
                await showPayout(from);

            } else if (buttonId === 'menu_6' || buttonId === 'menu_logout') {
                await handleLogout(from);

            } else if (buttonId === 'btn_go_back') {
                await sendMainMenu(from);
                userState[from] = 'LOGGED_IN_MENU';

            } else if (buttonId === 'btn_proceed') {
                await showBVReport(from);

            } else if (buttonId === 'btn_export') {
                await exportBVReport(from);
            }
        }
    }
    res.sendStatus(200);
});

// ==========================================
// API LOGIC
// ==========================================

async function verifyMobileAPI(from, mobileNumber) {
    try {
        const apiUrl = `http://www.darjuv9.com/webservice/Service.asmx/VerificationMobileNo?RegistrationMobileNo=${mobileNumber}&DeviceMobileNo=${mobileNumber}&IMEINo=&ConnectThru=&OperatorName=&OperatorCountry=&SIMSerialNo=&SIMSubscriberId=&SIMIMEINo=&HType=&vrsion=&DeviceModel=&DeviceName=`;
        const response = await axios.get(apiUrl);
        const data = response.data[0];

        if (data && data.Status === "true") {
            await sendReply(from, "User successfully verified! ✅\nPlease enter your associated ID:");
            userState[from] = 'WAITING_FOR_ID';
        } else {
            await sendReply(from, "This number does not exist.");
            delete userState[from];
        }
    } catch (e) { await sendReply(from, "Server error."); }
}

async function verifyAssociatedId(from, idString) {
    try {
        const apiUrl = `http://www.darjuv9.com/webservice/Service.asmx/CheckPlaceUplinerId?PlaceUplinerId=${idString}`;
        const response = await axios.get(apiUrl);
        const data = response.data[0];

        if (data && data.Status === "true") {
            await sendReply(from, `ID verified: ${data.MemName} 🎉\nPlease enter your password:`);
            userState[from] = 'WAITING_FOR_PASSWORD';
        } else {
            await sendReply(from, "ID does not exist.");
            delete userState[from];
        }
    } catch (e) { await sendReply(from, "Server error."); }
}

async function handleForgotPasswordAPI(from, userId) {
    try {
        const apiUrl = `http://www.darjuv9.com/webservice/Service.asmx/ForgotPassword?IDNo=${userId}&DeviceID=${from}`;
        const response = await axios.get(apiUrl);
        const data = response.data[0];

        if (data && data.Status === "True") {
            await sendReply(from, data.Message);
            await sendReply(from, "Please enter your password now or click Forgot Password again:");
            userState[from] = 'WAITING_FOR_PASSWORD';
        } else {
            await sendReply(from, "Failed to recover password. Please check your ID.");
            delete userState[from];
        }
    } catch (e) { await sendReply(from, "Server error."); }
}

// ==========================================
// MAIN MENU & FEATURES
// ==========================================

async function sendMainMenu(to) {
    const menuText = `📋 *Main Menu*\n\nPlease select an option:\n\n1️⃣ View Self BV\n2️⃣ Know Your Team BV\n3️⃣ Download Documents\n4️⃣ Know About Products\n5️⃣ Know Your Payout\n6️⃣ Logout\n\nYou can click buttons below or type a number (1-6):`;
    
    await sendButtons(to, menuText, [
        { id: "menu_1", title: "View Self BV" },
        { id: "menu_2", title: "Team BV" },
        { id: "menu_3", title: "Documents" }
    ]);
}

async function handleMainMenuSelection(from, input) {
    const choice = input.trim();
    
    if (choice === '1') {
        await sendReply(from, "Please enter FROM DATE (DD/MM/YYYY):");
        userState[from] = 'WAITING_FROM_DATE';
    } else if (choice === '2') {
        await showTeamBV(from);
    } else if (choice === '3') {
        await showDocuments(from);
    } else if (choice === '4') {
        await showProducts(from);
    } else if (choice === '5') {
        await showPayout(from);
    } else if (choice === '6') {
        await handleLogout(from);
    } else {
        await sendReply(from, "Invalid option. Please type a number between 1-6 or use the buttons.");
        await sendMainMenu(from);
    }
}

async function sendBVDateOptions(to) {
    const fromDate = userData[to]?.fromDate || 'N/A';
    const toDate = userData[to]?.toDate || 'N/A';
    
    await sendButtons(to, `📅 Date Range Selected:\n\nFrom: ${fromDate}\nTo: ${toDate}\n\nWhat would you like to do?`, [
        { id: "btn_proceed", title: "Proceed" },
        { id: "btn_export", title: "Export" },
        { id: "btn_go_back", title: "Go Back" }
    ]);
}

async function showBVReport(from) {
    const fromDate = userData[from]?.fromDate || 'N/A';
    const toDate = userData[from]?.toDate || 'N/A';
    
    const reportMsg = `📊 *Self BV Report*\n\n📅 Period: ${fromDate} to ${toDate}\n\n💰 Total BV: 1,250.00\n📈 Daily Average: 41.67\n🎯 Target: 2,000.00\n📉 Remaining: 750.00\n\n✅ Status: On Track`;
    
    await sendReply(from, reportMsg);
    await sendGoBackButton(from);
}

async function exportBVReport(from) {
    const fromDate = userData[from]?.fromDate || 'N/A';
    const toDate = userData[from]?.toDate || 'N/A';
    
    await sendReply(from, `📥 *Exporting BV Report*\n\nPeriod: ${fromDate} to ${toDate}\n\n✅ Your report has been generated!\n📧 Report will be sent to your registered email within 5 minutes.\n\n📄 Format: PDF`);
    await sendGoBackButton(from);
}

async function showTeamBV(from) {
    const teamMsg = `👥 *Team BV Summary*\n\n⬅️ Left Team BV: 2,601.00\n➡️ Right Team BV: 1,850.00\n📦 Total Team BV: 4,451.00\n\n👤 Active Members: 15\n🆕 New Joinings: 3\n🎯 Team Target: 10,000.00`;
    
    await sendReply(from, teamMsg);
    await sendGoBackButton(from);
}

async function showDocuments(from) {
    const docMsg = `📄 *Download Documents*\n\n1. ID Card\n2. Certificate\n3. Tax Documents\n4. Agreement Copy\n5. Product Catalog\n\n🔗 Click below to access:`;
    
    await sendReply(from, docMsg);
    await sendDocumentLink(from);
}

async function showProducts(from) {
    const productMsg = `🛍️ *Our Products*\n\n1. *Health Supplement A*\n   💰 Price: ₹1,500\n   📦 BV: 50\n\n2. *Wellness Pack B*\n   💰 Price: ₹3,000\n   📦 BV: 120\n\n3. *Premium Kit C*\n   💰 Price: ₹5,000\n   📦 BV: 200\n\n✨ All products are 100% natural and certified!`;
    
    await sendReply(from, productMsg);
    await sendGoBackButton(from);
}

async function showPayout(from) {
    const payoutMsg = `💵 *Your Payout Details*\n\n📅 Current Month: January 2025\n💰 Total Earning: ₹8,500.00\n✅ Paid Amount: ₹6,000.00\n⏳ Pending: ₹2,500.00\n\n📊 Breakdown:\n• Direct Income: ₹3,000\n• Level Income: ₹2,500\n• Matching Bonus: ₹3,000\n\n💳 Next Payout: 5th Feb 2025`;
    
    await sendReply(from, payoutMsg);
    await sendGoBackButton(from);
}

async function handleLogout(from) {
    await sendReply(from, "👋 You have been logged out successfully!\n\nThank you for using our service. Type 'hi' to start again.");
    delete userState[from];
    delete userData[from];
}

async function sendGoBackButton(to) {
    await sendButtons(to, "Choose an option:", [
        { id: "btn_go_back", title: "🔙 Go Back to Menu" }
    ]);
}

async function sendDocumentLink(to) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "cta_url",
                body: { text: "Access all your documents here:" },
                action: {
                    name: "cta_url",
                    parameters: { display_text: "Download Documents", url: "https://www.darjuv9.com/documents" }
                }
            }
        }, { headers: { Authorization: `Bearer ${token}` } });
        await sendGoBackButton(to);
    } catch (e) { console.error("Document Link Error"); }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function sendWelcomeOptions(to) {
    await sendButtons(to, "Welcome to the bot! Are you an existing or new user?", [
        { id: "btn_existing", title: "Existing User" },
        { id: "btn_new", title: "New User" }
    ]);
}

async function sendPasswordErrorOptions(to) {
    await sendButtons(to, "Password is incorrect! ❌\nKya aap dobara koshish karna chahte hain ya password bhool gaye?", [
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
    } catch (e) { console.error("Text Error"); }
}

app.listen(3000, () => console.log('Server is listening on port 3000'));