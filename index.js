// ==Bookmarklet Script==
// @name         OpenPhone Deep Archiver (Folder Fix Edition)
// @description  Correctly creates media/summary subfolders only when needed, preventing empty folders in the ZIP archive.
// @version      1.0
// @author       ilakskills
// ==/Bookmarklet Script==

(() => {
    // --- CONFIGURATION ---
    const AUTH_COOKIE_NAME = 'openphone_auth_token';

    // --- SVG Icons ---
    const downloadIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="white" d="M5 20h14v-2H5v2zm7-18a1 1 0 0 1 1 1v10.59l3.29-3.3a1 1 0 1 1 1.42 1.42l-5 5a1 1 0 0 1-1.42 0l-5-5a1 1 0 1 1 1.42-1.42L11 13.59V3a1 1 0 0 1 1-1z"></path></svg>`;

    // --- UI HELPER FUNCTIONS ---
    const injectStyles = () => {
        const styleId = 'op-archiver-styles';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .archiver-floating-container { position: fixed !important; bottom: 30px !important; left: 30px !important; z-index: 999990 !important; display: flex; align-items: center; background: #198754; border-radius: 50px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
            .archiver-main-button { background: transparent; border: none; padding: 12px 16px; cursor: pointer; color: white; font-weight: 500; font-size: 16px; display: flex; align-items: center; gap: 8px; }
            .archiver-main-button:hover { background: #146c43; border-top-left-radius: 50px; border-bottom-left-radius: 50px; }
            .archiver-main-button:disabled { background: #5a5a5a; cursor: not-allowed; }
            .archiver-test-button { background: rgba(255,255,255,0.1); border: none; border-left: 1px solid rgba(255,255,255,0.3); padding: 12px; cursor: pointer; color: white; font-size: 14px; border-top-right-radius: 50px; border-bottom-right-radius: 50px; }
            .archiver-test-button:hover { background: rgba(0,0,0,0.2); }
            .archiver-test-button:disabled { background: #5a5a5a; color: #aaa; cursor: not-allowed; }
            .archiver-toast { position: fixed !important; bottom: 20px !important; left: 50%; transform: translateX(-50%); background-color: #212529; color: white; padding: 10px 20px; border-radius: 6px; z-index: 1000000 !important; font-size: 14px; transition: opacity 0.5s; opacity: 1; }
            .archiver-toast.success { background-color: #198754; }
            .archiver-toast.error { background-color: #dc3545; }
        `;
        document.head.appendChild(style);
    };

    const showToast = (message, type = 'success', duration = 4000) => {
        const existingToast = document.querySelector('.archiver-toast');
        if (existingToast) existingToast.remove();
        const toast = document.createElement('div');
        toast.className = `archiver-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 500);
        }, duration);
    };

    const loadJsZip = () => {
        return new Promise((resolve, reject) => {
            if (window.JSZip) return resolve();
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load JSZip library."));
            document.head.appendChild(script);
        });
    };

    // --- CORE LOGIC ---
    const getCookie = name => { const value = `; ${document.cookie}`; const parts = value.split(`; ${name}=`); if (parts.length === 2) return parts.pop().split(';').shift(); };
    const setCookie = (name, value, days = 7) => { let expires = ""; if (days) { const date = new Date(); date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000)); expires = "; expires=" + date.toUTCString(); } document.cookie = `${name}=${value||""}${expires}; path=/`; };
    
    const initAuthSpy = () => {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const headers = args[1]?.headers;
            if (headers && (headers.Authorization || headers.authorization)) {
                setCookie(AUTH_COOKIE_NAME, headers.Authorization || headers.authorization);
            }
            return originalFetch.apply(this, args);
        };
        const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
            if (header.toLowerCase() === 'authorization') {
                setCookie(AUTH_COOKIE_NAME, value);
            }
            return originalXhrSetRequestHeader.apply(this, arguments);
        };
        console.log("✅ Archiver Auth Spy initialized.");
    };

    const getAuthToken = () => {
        return new Promise((resolve, reject) => {
            const token = getCookie(AUTH_COOKIE_NAME);
            if (token) {
                resolve(token);
            } else {
                reject(new Error("Auth token not yet captured. Please interact with the page (e.g., click a message) and try again."));
            }
        });
    };

    const runDownloadProcess = async (button) => {
        button.disabled = true;
        button.innerHTML = `${downloadIconSVG}<span>Archiving...</span>`;
        try {
            const conversationId = window.location.href.split("/").find(p => p.startsWith("CN"));
            if (!conversationId) throw new Error("Could not find Conversation ID in URL.");
            let authToken = await getAuthToken();
            let allActivities = [];
            let nextCursor = null;
            let pageCount = 1;
            let hasMorePages = true;

            showToast(`Fetching page 1...`);
            while (hasMorePages) {
                const apiUrl = `https://communication.openphoneapi.com/v2/activity?id=${conversationId}&last=200${nextCursor ? `&before=${nextCursor}` : ''}`;
                let response = await fetch(apiUrl, { headers: { Authorization: authToken } });
                if (response.status === 401) {
                    setCookie(AUTH_COOKIE_NAME, '', -1);
                    throw new Error("Auth token expired. Please interact with the page to refresh it and try again.");
                }
                if (!response.ok) throw new Error(`API request failed: ${response.status}`);
                const pageData = await response.json();
                if (pageData.result && pageData.result.length > 0) { allActivities.push(...pageData.result); }
                if (pageData.pageInfo && pageData.pageInfo.hasPreviousPage) {
                    nextCursor = pageData.pageInfo.startId;
                    pageCount++;
                    showToast(`Fetching page ${pageCount}... (${allActivities.length} activities so far)`);
                } else { hasMorePages = false; }
            }
            showToast(`Finished fetching. Found ${allActivities.length} total activities.`);
            await createConversationZip(allActivities, conversationId);
        } catch (error) {
            console.error("❌ An error occurred during archiving:", error);
            showToast(error.message, "error");
        } finally {
            button.disabled = false;
            button.innerHTML = `${downloadIconSVG}<span>Download Deep Archive</span>`;
        }
    };

    const createConversationZip = async (activities, conversationId) => {
        showToast("Processing data and creating ZIP file...");
        await loadJsZip();
        const zip = new window.JSZip();
        activities.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        let unifiedTranscript = "";
        const dataByDate = {};
        zip.file("full_conversation_log.json", JSON.stringify(activities, null, 2));

        for (const activity of activities) {
            const date = new Date(activity.createdAt);
            const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            if (!dataByDate[dateString]) { dataByDate[dateString] = { texts: [], media: [], calls: [] }; }

            const timeStringForFile = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
            const fullTimestampForLog = `${dateString} ${timeStringForFile.replace(/-/g, ':')}`;
            const sender = activity.from || 'System';
            const sanitizedSender = sender.replace(/[^\w]/g, '');

            if (activity.type === 'message' && activity.body) {
                const direction = activity.direction === 'incoming' ? '<<<' : '>>>';
                unifiedTranscript += `[${fullTimestampForLog}] ${direction} ${sender}:\n${activity.body}\n\n`;
            } else if (activity.type === 'call' && activity.callTranscript?.dialogue) {
                unifiedTranscript += `--- CALL TRANSCRIPT [${fullTimestampForLog}] ---\n`;
                unifiedTranscript += activity.callTranscript.dialogue.map(d => `${d.identifier || 'Unknown'}: ${d.content}`).join('\n');
                unifiedTranscript += `\n--- END TRANSCRIPT ---\n\n`;
                dataByDate[dateString].calls.push({ from: sanitizedSender, timestamp: timeStringForFile, summary: activity.callSummary, transcript: activity.callTranscript });
            }

            if (activity.media && Array.isArray(activity.media)) {
                for (const mediaItem of activity.media) {
                    if (mediaItem.url) { dataByDate[dateString].media.push({ url: mediaItem.url, type: mediaItem.type, from: sanitizedSender, timestamp: timeStringForFile }); }
                }
            }
        }
        zip.file("full_conversation.txt", unifiedTranscript);

        const allPromises = [];
        for (const date in dataByDate) {
            const dayData = dataByDate[date];
            if (dayData.media.length === 0 && dayData.calls.length === 0) continue; // Skip creating a folder for days with no files

            const dateFolder = zip.folder(date);
            let subfolders = {}; // Keep track of created subfolders for this date

            const getSubfolder = (name) => {
                if (!subfolders[name]) {
                    subfolders[name] = dateFolder.folder(name);
                }
                return subfolders[name];
            };
            
            dayData.calls.forEach(call => {
                let callContent = "--- CALL SUMMARY ---\n";
                if (call.summary && call.summary.summary) { callContent += call.summary.summary.join('\n') + '\n\n'; }
                if (call.summary && call.summary.nextSteps && call.summary.nextSteps.length > 0) { callContent += "--- NEXT STEPS ---\n" + call.summary.nextSteps.join('\n') + '\n\n'; }
                if (call.transcript && call.transcript.dialogue) { callContent += "--- TRANSCRIPT ---\n" + call.transcript.dialogue.map(d => `${d.identifier || 'Unknown'}: ${d.content}`).join('\n'); }
                const filename = `${call.timestamp}_call_summary_from_${call.from}.txt`;
                getSubfolder("call_summaries").file(filename, callContent);
            });

            dayData.media.forEach(media => {
                const promise = fetch(media.url)
                    .then(response => { if (!response.ok) throw new Error("Fetch failed"); return response.blob(); })
                    .then(blob => {
                        const extension = media.type.split('/')[1] || 'file';
                        const filename = `${media.timestamp}_from_${media.from}.${extension}`;
                        if (media.type.startsWith('image/')) {
                            getSubfolder("images").file(filename, blob);
                        } else {
                            getSubfolder("audio").file(filename, blob);
                        }
                    }).catch(e => console.error(`Failed to download media ${media.url}:`, e));
                allPromises.push(promise);
            });
        }
        
        await Promise.all(allPromises);
        showToast("All files processed. Generating ZIP...");
        
        const contactNameElement = document.querySelector('[data-test-id="conversation-header-title"]');
        const contactName = contactNameElement ? contactNameElement.textContent.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-") : conversationId;
        const zipFilename = `${new Date().toISOString().split('T')[0]}_${contactName}_Archive.zip`;
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = zipFilename;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast("ZIP file download initiated!", "success");
    };

    const runDiagnostics = async (testButton) => {
        testButton.disabled = true;
        showToast("Running diagnostics...", 'success');
        try {
            showToast("1/3: Checking for Auth Token...", 'success', 2000);
            const authToken = await getAuthToken();
            if (!authToken) throw new Error("Token is empty or could not be read.");
            await new Promise(r => setTimeout(r, 1000));
            showToast("✅ Auth Token: OK", "success", 2000);
            
            await new Promise(r => setTimeout(r, 1000));
            showToast("2/3: Testing API Connection...", 'success', 2000);
            const conversationId = window.location.href.split("/").find(p => p.startsWith("CN"));
            if (!conversationId) throw new Error("Not on a conversation page.");
            const testUrl = `https://communication.openphoneapi.com/v2/activity?id=${conversationId}&last=1`;
            const response = await fetch(testUrl, { headers: { Authorization: authToken }});
            if (!response.ok) throw new Error(`API returned status ${response.status}`);
            await new Promise(r => setTimeout(r, 1000));
            showToast(`✅ API Connection: OK (Status ${response.status})`, "success", 2000);

            await new Promise(r => setTimeout(r, 1000));
            showToast("3/3: Testing ZIP Library...", 'success', 2000);
            await loadJsZip();
            const zip = new window.JSZip();
            zip.file("test.txt", "This is a test.");
            await zip.generateAsync({ type: "blob" });
            await new Promise(r => setTimeout(r, 1000));
            showToast("✅ ZIP Library: OK", "success", 2000);
            
            await new Promise(r => setTimeout(r, 1000));
            showToast("✅ All Systems Operational!", "success");
        } catch (error) {
            console.error("❌ Diagnostic test failed:", error);
            showToast(`❌ Test FAILED: ${error.message}`, "error");
        } finally {
            testButton.disabled = false;
        }
    };

    // --- INITIALIZATION LOGIC ---
    const createFloatingButton = () => {
        document.getElementById('op-archiver-button-container')?.remove();
        const container = document.createElement('div');
        container.id = 'op-archiver-button-container';
        container.className = 'archiver-floating-container';
        const mainButton = document.createElement('button');
        mainButton.className = 'archiver-main-button';
        mainButton.innerHTML = `${downloadIconSVG}<span>Download Deep Archive</span>`;
        mainButton.addEventListener('click', () => runDownloadProcess(mainButton));
        const testButton = document.createElement('button');
        testButton.className = 'archiver-test-button';
        testButton.textContent = '[Test]';
        testButton.title = "Run diagnostics";
        testButton.addEventListener('click', () => runDiagnostics(testButton));
        container.appendChild(mainButton);
        container.appendChild(testButton);
        document.body.appendChild(container);
        console.log("✅ Conversation Archiver button added.");
    };

    console.log("🚀 Initializing OpenPhone Deep Archiver...");
    injectStyles();
    initAuthSpy();
    createFloatingButton();
})();
