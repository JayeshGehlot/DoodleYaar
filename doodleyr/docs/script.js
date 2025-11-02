// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {
    
    // --- Initialize Socket.io connection ---
    // This connects to the server that is serving this file.
    const socket = io('https://doodle-yaar-backend.onrender.com');

    // --- Global State ---
    let userId = null; // This will be our socket.id
    let currentSessionCode = null;
    let currentNickname = null;
    let hostId = null; // Changed from isHost
    let tool = 'pencil';
    let color = '#000000';
    let brushSize = 5;
    let opacity = 1;
    let isDrawing = false;
    let currentStroke = [];
    let strokes = new Map();
    let liveStrokes = new Map();
    
    // --- Throttling variables ---
    let lastDrawTime = 0;
    const drawThrottleLimit = 50; // Milliseconds (approx 20 updates/sec)
    let pendingDrawUpdate = null;


    // --- DOM Elements ---
    const loadingScreen = document.getElementById('loading-screen');
    const landingScreen = document.getElementById('landing-screen');
    const appScreen = document.getElementById('app-screen');
    const errorMessage = document.getElementById('error-message');
    const nicknameInput = document.getElementById('nickname-input');
    const sessionCodeInput = document.getElementById('session-code-input');
    const joinSessionBtn = document.getElementById('join-session-btn');
    const createSessionBtn = document.getElementById('create-session-btn');
    const canvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d');
    const sessionCodeDisplay = document.getElementById('session-code-display');
    const toolPencil = document.getElementById('tool-pencil');
    const toolEraser = document.getElementById('tool-eraser');
    const toolWatercolor = document.getElementById('tool-watercolor');
    const toolOil = document.getElementById('tool-oil');
    const toolUndo = document.getElementById('tool-undo');
    const toolClear = document.getElementById('tool-clear');
    const toolSave = document.getElementById('tool-save');
    const colorPicker = document.getElementById('color-picker');
    const brushSizeSlider = document.getElementById('brush-size-slider');
    const opacitySlider = document.getElementById('opacity-slider');
    const leaveBtn = document.getElementById('leave-btn');
    const chatTab = document.getElementById('chat-tab');
    const membersTab = document.getElementById('members-tab');
    const membersCount = document.getElementById('members-count');
    const chatPanel = document.getElementById('chat-panel');
    const membersPanel = document.getElementById('members-panel');
    const chatMessages = document.getElementById('chat-messages');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const modalContainer = document.getElementById('modal-container');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    
    // --- Helper Functions ---
    const showError = (msg) => {
        errorMessage.textContent = msg;
        errorMessage.classList.remove('hidden');
    };
    const clearError = () => {
        errorMessage.classList.add('hidden');
    };

    const showModal = (onConfirm) => {
        modalContainer.classList.remove('hidden');
        modalConfirmBtn.onclick = () => {
            onConfirm();
            modalContainer.classList.add('hidden');
        };
        modalCancelBtn.onclick = () => {
            modalContainer.classList.add('hidden');
        };
    };

    // --- Canvas Drawing Logic (Unchanged from Firebase version) ---
    const drawStroke = (strokeCtx, stroke) => {
        if (!strokeCtx || !stroke || !stroke.points || stroke.points.length === 0) return;
        
        const { points, color, size, opacity, tool } = stroke;
        const canvasEl = strokeCtx.canvas;
        
        strokeCtx.lineCap = 'round';
        strokeCtx.lineJoin = 'round';
        strokeCtx.strokeStyle = color;
        strokeCtx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
        strokeCtx.shadowBlur = 0; 

        switch (tool) {
            case 'pencil':
                strokeCtx.lineWidth = size;
                strokeCtx.globalAlpha = opacity;
                break;
            case 'eraser':
                strokeCtx.lineWidth = size;
                strokeCtx.globalAlpha = 1;
                break;
            case 'watercolor':
                strokeCtx.lineWidth = size * 1.2;
                strokeCtx.globalAlpha = opacity * 0.2;
                strokeCtx.shadowBlur = size;
                strokeCtx.shadowColor = color;
                break;
            case 'oil':
                strokeCtx.lineWidth = size * 1.5;
                strokeCtx.globalAlpha = opacity * 0.6;
                break;
            default:
                strokeCtx.lineWidth = size;
                strokeCtx.globalAlpha = opacity;
        }

        strokeCtx.beginPath();
        strokeCtx.moveTo(points[0].x * canvasEl.width, points[0].y * canvasEl.height);

        if (points.length < 3) {
            if(points.length === 1) {
                strokeCtx.lineTo(points[0].x * canvasEl.width + 1, points[0].y * canvasEl.height + 1);
            } else {
                strokeCtx.lineTo(points[1].x * canvasEl.width, points[1].y * canvasEl.height);
            }
        } else {
            for (let i = 1; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i+1];
                const mid2_x = (p1.x + p2.x) * canvasEl.width / 2;
                const mid2_y = (p1.y + p2.y) * canvasEl.height / 2;
                strokeCtx.quadraticCurveTo(p1.x * canvasEl.width, p1.y * canvasEl.height, mid2_x, mid2_y);
            }
            const last = points[points.length - 1];
            strokeCtx.lineTo(last.x * canvasEl.width, last.y * canvasEl.height);
        }
        strokeCtx.stroke();
        
        strokeCtx.globalCompositeOperation = 'source-over';
        strokeCtx.shadowBlur = 0;
        strokeCtx.globalAlpha = 1;
    };

    const redrawCanvas = () => {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        
        strokes.forEach(stroke => drawStroke(ctx, stroke));
        
        liveStrokes.forEach(stroke => {
            if (stroke.userId !== userId) drawStroke(ctx, stroke);
        });

        if (isDrawing && currentStroke.length > 0) {
            drawStroke(ctx, { points: currentStroke, color, size: brushSize, opacity, tool });
        }
    };

    const resizeCanvas = () => {
        if (!canvas) return;
        const { width, height } = canvas.getBoundingClientRect();
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            redrawCanvas();
        }
    };

    const getPoint = (e) => {
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || e.touches?.[0]?.clientX;
        const clientY = e.clientY || e.touches?.[0]?.clientY;
        if (clientX === undefined || clientY === undefined) return null;

        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    };

    // --- Socket.io Drawing Emitters ---
    const startDrawing = (e) => {
        e.preventDefault();
        const point = getPoint(e);
        if (!point) return;
        isDrawing = true;
        currentStroke = [point];
        // Emit 'start-stroke' to server
        socket.emit('start-stroke', { points: [point], color, size: brushSize, opacity, tool });
    };

    const sendDrawUpdate = () => {
        // Emit 'draw-stroke' to server
        socket.emit('draw-stroke', { points: currentStroke });
        pendingDrawUpdate = null;
    };

    const draw = (e) => {
        e.preventDefault();
        if (!isDrawing) return;
        const point = getPoint(e);
        if (!point) return;
        
        currentStroke.push(point);
        redrawCanvas(); // Local redraw
        
        const now = Date.now();
        if (now - lastDrawTime > drawThrottleLimit) {
            lastDrawTime = now;
            if (pendingDrawUpdate) clearTimeout(pendingDrawUpdate);
            sendDrawUpdate();
        } else if (!pendingDrawUpdate) {
            pendingDrawUpdate = setTimeout(sendDrawUpdate, drawThrottleLimit / 2);
        }
    };

    const stopDrawing = (e) => {
        e.preventDefault();
        if (!isDrawing) return;
        isDrawing = false;
        
        if (pendingDrawUpdate) {
            clearTimeout(pendingDrawUpdate);
            pendingDrawUpdate = null;
        }
        
        if (currentStroke.length > 0) {
            // Emit final 'end-stroke' to server
            socket.emit('end-stroke', { points: currentStroke, color, size: brushSize, opacity, tool });
        }
        currentStroke = [];
    };

    // --- UI Update Functions ---
    const updateMemberListUI = (members) => {
        if (!membersPanel || !membersCount) return; 
        membersPanel.innerHTML = '';
        const memberCount = Object.keys(members).length;
        membersCount.textContent = `Members (${memberCount})`;
        
        Object.entries(members).forEach(([id, nick]) => {
            const div = document.createElement('div');
            div.className = "flex items-center space-x-2 p-2 rounded-md";
            
            const statusDot = document.createElement('span');
            statusDot.className = `w-3 h-3 rounded-full ${id === userId ? 'bg-green-500' : 'bg-gray-400'}`;
            
            const name = document.createElement('span');
            name.className = "text-sm font-medium";
            name.textContent = nick;
            
            div.appendChild(statusDot);
            div.appendChild(name);
            
            if (id === userId) {
                const you = document.createElement('span');
                you.className = "text-xs font-normal text-gray-500";
                you.textContent = "(You)";
                div.appendChild(you);
            }
            if (id === hostId) { // Use global hostId
                const host = document.createElement('span');
                host.className = "text-xs font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full";
                host.textContent = "Host";
                div.appendChild(host);
            }
            membersPanel.appendChild(div);
        });
    };

    const updateChatUI = (messages) => {
        if (!chatMessages) return; 
        chatMessages.innerHTML = '';
        // Sort by server timestamp
        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        messages.forEach(msg => {
            const outerDiv = document.createElement('div');
            outerDiv.className = `flex ${msg.userId === userId ? 'justify-end' : 'justify-start'}`;
            
            const innerDiv = document.createElement('div');
            innerDiv.className = `p-2 rounded-lg max-w-xs ${msg.userId === userId ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-800'}`;
            
            if (msg.userId !== userId) {
                const nick = document.createElement('div');
                nick.className = "text-xs font-bold opacity-70";
                nick.textContent = msg.nickname;
                innerDiv.appendChild(nick);
            }
            
            const p = document.createElement('p');
            p.className = "text-sm break-words";
            p.textContent = msg.message;
            innerDiv.appendChild(p);
            outerDiv.appendChild(innerDiv);
            chatMessages.appendChild(outerDiv);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    // --- App Initialization ---
    const initApp = (code, nick, initialHostId, initialMembers, initialStrokes, initialChat) => {
        currentSessionCode = code;
        currentNickname = nick;
        hostId = initialHostId; // Set the host
        
        sessionCodeDisplay.textContent = code;
        
        // Load initial data
        strokes.clear();
        initialStrokes.forEach(s => strokes.set(s.id, s));
        updateMemberListUI(initialMembers || {});
        updateChatUI(initialChat || {});
        
        // Show/hide host controls
        toolClear.classList.toggle('hidden', hostId !== userId);
        
        // Switch screens
        landingScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        appScreen.classList.add('flex');

        // Add App listeners
        window.addEventListener('resize', resizeCanvas);
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);

        // Tool selection
        const toolBtns = [toolPencil, toolWatercolor, toolOil, toolEraser];
        const toolMap = {
            'tool-pencil': 'pencil',
            'tool-watercolor': 'watercolor',
            'tool-oil': 'oil',
            'tool-eraser': 'eraser'
        };

        toolBtns.forEach(btn => {
            if (!btn) return;
            btn.onclick = () => {
                tool = toolMap[btn.id];
                toolBtns.forEach(b => {
                    if (b) {
                        b.classList.remove('bg-indigo-100', 'text-indigo-700');
                        b.classList.add('hover:bg-gray-100');
                    }
                });
                btn.classList.add('bg-indigo-100', 'text-indigo-700');
                btn.classList.remove('hover:bg-gray-100');
            };
        });

        if (toolUndo) toolUndo.onclick = handleUndo;
        if (toolClear) toolClear.onclick = () => showModal(executeClearCanvas);
        if (toolSave) toolSave.onclick = handleSaveDrawing;
        if (leaveBtn) leaveBtn.onclick = handleLeave;

        if (colorPicker) colorPicker.oninput = (e) => color = e.target.value;
        if (brushSizeSlider) brushSizeSlider.oninput = (e) => brushSize = Number(e.target.value);
        if (opacitySlider) opacitySlider.oninput = (e) => opacity = Number(e.target.value);
        
        if (chatTab) chatTab.onclick = () => {
            chatPanel.classList.remove('hidden');
            membersPanel.classList.add('hidden');
            chatTab.classList.add('border-indigo-500', 'text-indigo-600');
            membersTab.classList.remove('border-indigo-500', 'text-indigo-600');
        };
        if (membersTab) membersTab.onclick = () => {
            membersPanel.classList.remove('hidden');
            chatPanel.classList.add('hidden');
            membersTab.classList.add('border-indigo-500', 'text-indigo-600');
            chatTab.classList.remove('border-indigo-500', 'text-indigo-600');
        };
        if (chatForm) chatForm.onsubmit = handleChatSubmit;
        
        resizeCanvas();
    };

    // --- Socket.io Event Handlers ---
    
    // Set our user ID on successful connection
    socket.on('connect', () => {
        userId = socket.id;
        console.log("Connected to server with ID:", userId);
        loadingScreen.classList.add('hidden');
        landingScreen.classList.remove('hidden');
        landingScreen.classList.add('flex');
    });

    // --- Landing Page Logic ---
    const handleCreateSession = () => {
        const nick = nicknameInput.value.trim();
        if (!nick) return showError('Please enter a nickname.');
        clearError();
        createSessionBtn.disabled = true;
        socket.emit('create-session', { nick });
    };

    const handleJoinSession = () => {
        const nick = nicknameInput.value.trim();
        const code = sessionCodeInput.value.toUpperCase().trim();
        if (!nick) return showError('Please enter a nickname.');
        if (!code) return showError('Please enter a session code.');
        clearError();
        joinSessionBtn.disabled = true;
        socket.emit('join-session', { nick, code });
    };

    // --- App Event Handlers (Socket Emitters) ---
    const handleChatSubmit = (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message === '') return;
        chatInput.value = '';
        socket.emit('send-message', { message, nickname: currentNickname });
    };

    const handleUndo = () => {
        socket.emit('undo-stroke');
    };

    const executeClearCanvas = () => {
        socket.emit('clear-canvas');
    };

    const handleSaveDrawing = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height); 
        tempCtx.drawImage(canvas, 0, 0);
        
        const dataUrl = tempCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `doodle-yaar-${currentSessionCode}.png`;
        link.href = dataUrl;
        link.click();
    };

    const handleLeave = () => {
        // Disconnect and reload
        socket.disconnect();
        window.location.reload();
    };

    // --- Socket.io Listeners (Data Receivers) ---
    
    socket.on('session-created', ({ code, nick, hostId: newHostId }) => {
        initApp(code, nick, newHostId, { [userId]: nick }, [], []);
    });

    socket.on('join-success', ({ code, nick, hostId: newHostId, members, strokes: allStrokes, chat }) => {
        initApp(code, nick, newHostId, members, allStrokes, chat);
    });

    socket.on('error-message', (message) => {
        showError(message);
        createSessionBtn.disabled = false;
        joinSessionBtn.disabled = false;
    });

    socket.on('update-members', (members) => {
        updateMemberListUI(members);
    });
    
    socket.on('new-host', (newHostId) => {
        hostId = newHostId;
        toolClear.classList.toggle('hidden', hostId !== userId);
        // We also call updateMemberListUI to update the "(Host)" tag
        updateMemberListUI(JSON.parse(membersCount.dataset.members || '{}')); // A bit of a hack to get current members
    });

    socket.on('update-chat', (chat) => {
        updateChatUI(chat);
    });

    socket.on('new-stroke', (stroke) => {
        strokes.set(stroke.id, stroke);
        redrawCanvas();
    });

    socket.on('live-stroke', (stroke) => {
        liveStrokes.set(stroke.userId, stroke);
        redrawCanvas();
    });

    socket.on('end-live-stroke', (removedUserId) => {
        liveStrokes.delete(removedUserId);
        redrawCanvas();
    });

    socket.on('remove-stroke', (strokeId) => {
        strokes.delete(strokeId);
        redrawCanvas();
    });

    socket.on('canvas-cleared', () => {
        strokes.clear();
        redrawCanvas();
    });

    // --- Initial Landing Page Setup ---
    function initLandingPageListeners() {
        if (createSessionBtn) createSessionBtn.onclick = handleCreateSession;
        if (joinSessionBtn) joinSessionBtn.onclick = handleJoinSession;

        // Disable buttons until inputs are valid
        if (createSessionBtn) createSessionBtn.disabled = true;
        if (joinSessionBtn) joinSessionBtn.disabled = true;

        const validateInputs = () => {
            const nick = nicknameInput ? nicknameInput.value.trim() : '';
            const code = sessionCodeInput ? sessionCodeInput.value.trim() : '';
            
            if (createSessionBtn) createSessionBtn.disabled = !nick;
            if (joinSessionBtn) joinSessionBtn.disabled = !(nick && code);
        };

        if (nicknameInput) nicknameInput.addEventListener('input', validateInputs);
        if (sessionCodeInput) sessionCodeInput.addEventListener('input', validateInputs);
    }
    
    // Start the landing page listeners
    initLandingPageListeners();
});
