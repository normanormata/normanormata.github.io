// Ask: sends a question to the assistant Worker named by the assistant-url meta
// tag (site.assistant_url) and streams back an answer drawn from this site's own
// documents. It runs in two places: the /ask/ page, and the side panel that the
// toolbar's Ask button opens beside any page (_includes/ask-panel.html).
//
// A citation in the answer becomes a link only when the Worker actually gave
// that section to the model (the `sources` event), so a citation the model
// invented stays plain text. The answer is built with text nodes throughout,
// never innerHTML: it is model output.
//
// The conversation is kept in sessionStorage and shared by the page and the
// panel. The panel lives in <body>, outside .book, so GitBook's in-place page
// swaps (theme.js replaces only .book) leave it open, even mid-answer.

require(['gitbook', 'jquery'], function(gitbook, $) {
    'use strict';

    var STORAGE_KEY = 'ask-conversation';
    var PANEL_KEY = 'ask-panel-open';
    var MAX_HISTORY_EXCHANGES = 3;   // the Worker accepts up to 6 prior turns

    function assistantUrl() {
        var meta = document.querySelector('meta[name="assistant-url"]');
        var url = meta && meta.getAttribute('content');
        return url ? url.replace(/\/+$/, '') : '';
    }

    function sessionGet(key) {
        try { return sessionStorage.getItem(key); } catch (error) { return null; }
    }
    function sessionSet(key, value) {
        try {
            if (value === null) sessionStorage.removeItem(key);
            else sessionStorage.setItem(key, value);
        } catch (error) { /* private mode */ }
    }
    function load() {
        try { return JSON.parse(sessionGet(STORAGE_KEY) || 'null'); } catch (error) { return null; }
    }
    function save(exchanges) {
        sessionSet(STORAGE_KEY, JSON.stringify(exchanges));
    }
    function forget() {
        sessionSet(STORAGE_KEY, null);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function normalizeLabel(label) {
        return String(label).toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim();
    }

    function indexSources(sources) {
        var byLabel = {};
        (sources || []).forEach(function(source) { byLabel[normalizeLabel(source.reference)] = source; });
        return byLabel;
    }

    // ── Rendering an answer ──────────────────────────────────────────────

    // "[WCF 17.1; WLC 79]" or "[WCF 17.1, 17.2]": link each part the Worker
    // supplied. Returns null when no part matches, leaving the text alone.
    function citationNodes(inner, byLabel, cited) {
        var pieces = inner.split(/(\s*[;,]\s*)/);
        var nodes = [];
        var linked = 0;
        var documentPrefix = '';
        pieces.forEach(function(piece, i) {
            if (i % 2 === 1) {                       // a separator
                nodes.push(document.createTextNode(piece));
                return;
            }
            // A trailing proof letter ("WCF 1.6 m") or lettered sub-item ("DPW 1.A.4.a")
            // belongs to the section it follows.
            var source = byLabel[normalizeLabel(piece)] ||
                byLabel[normalizeLabel(piece.replace(/[.\s]\s*[a-z]$/, ''))];
            if (!source && documentPrefix && /^[\d./]/.test(piece)) {
                source = byLabel[normalizeLabel(documentPrefix + ' ' + piece)];
            }
            var prefix = /^(.*?[A-Za-z’'])\s+\d/.exec(piece);
            if (prefix) documentPrefix = prefix[1];
            if (!source) {
                nodes.push(document.createTextNode(piece));
                return;
            }
            linked++;
            if (cited.indexOf(source) === -1) cited.push(source);
            var link = el('a', 'ask__cite', piece);
            link.href = source.url;
            link.title = source.title;
            nodes.push(link);
        });
        return linked ? nodes : null;
    }

    // Citations in [brackets], or in (parentheses) as some models write them; a
    // parenthesis becomes links only when it names sections that were supplied.
    function appendLine(parent, line, byLabel, cited) {
        var pattern = /\[([^\[\]]{1,80})\]|\(([^()]{1,80})\)/g;
        var last = 0;
        var match;
        while ((match = pattern.exec(line))) {
            var bracket = match[1] !== undefined;
            var nodes = citationNodes(bracket ? match[1] : match[2], byLabel, cited);
            if (!nodes) continue;
            parent.appendChild(document.createTextNode(line.slice(last, match.index) + (bracket ? '[' : '(')));
            nodes.forEach(function(node) { parent.appendChild(node); });
            parent.appendChild(document.createTextNode(bracket ? ']' : ')'));
            last = pattern.lastIndex;
        }
        parent.appendChild(document.createTextNode(line.slice(last)));
    }

    // Plain text in paragraphs. The model is asked not to use Markdown; strip
    // the emphasis and heading marks it sometimes uses anyway.
    function renderAnswer(container, text, sources) {
        var byLabel = indexSources(sources);
        var cited = [];
        container.textContent = '';
        String(text)
            .replace(/【/g, '[').replace(/】/g, ']')   // gpt-oss's citation brackets
            .replace(/\*\*|__/g, '')
            .replace(/^#{1,6}\s+/gm, '')
            .split(/\n{2,}/)
            .forEach(function(block) {
                if (!block.trim()) return;
                var paragraph = el('p');
                block.trim().split('\n').forEach(function(line, i) {
                    if (i) paragraph.appendChild(el('br'));
                    appendLine(paragraph, line, byLabel, cited);
                });
                container.appendChild(paragraph);
            });
        return cited;
    }

    function sourceItem(source) {
        var item = el('li');
        var link = el('a', null, source.reference);
        link.href = source.url;
        item.appendChild(link);
        item.appendChild(el('span', 'ask__source-doc', ' ' + source.document.replace(/^The /, '')));
        return item;
    }

    function renderSources(container, sources, cited) {
        container.textContent = '';
        if (!sources || !sources.length) return;
        var others = sources.filter(function(source) { return cited.indexOf(source) === -1; });
        if (cited.length) {
            container.appendChild(el('h3', 'ask__sources-title', 'Sections cited'));
            var list = el('ul', 'ask__source-list');
            cited.forEach(function(source) { list.appendChild(sourceItem(source)); });
            container.appendChild(list);
        }
        if (others.length) {
            var details = el('details', 'ask__consulted');
            details.appendChild(el('summary', null,
                (cited.length ? 'Other sections consulted' : 'Sections consulted') + ' (' + others.length + ')'));
            var more = el('ul', 'ask__source-list');
            others.forEach(function(source) { more.appendChild(sourceItem(source)); });
            details.appendChild(more);
            container.appendChild(details);
        }
    }

    function renderExchange(exchange) {
        var view = {
            root: el('section', 'ask__exchange'),
            answer: el('div', 'ask__answer'),
            sources: el('div', 'ask__sources'),
            meta: el('p', 'ask__meta')
        };
        view.root.appendChild(el('h2', 'ask__question', exchange.question));
        if (exchange.about) view.root.appendChild(el('p', 'ask__about-note', 'Asked while reading ' + exchange.about));
        view.root.appendChild(view.answer);
        view.root.appendChild(view.sources);
        view.root.appendChild(view.meta);
        update(view, exchange);
        return view;
    }

    function update(view, exchange) {
        var cited = renderAnswer(view.answer, exchange.answer, exchange.sources);
        if (exchange.error) view.answer.appendChild(el('p', 'ask__error', exchange.error));
        renderSources(view.sources, exchange.sources, cited);
        view.meta.textContent = exchange.model
            ? 'Answered by ' + exchange.model + (exchange.fallback ? ', the backup model' : '')
            : '';
    }

    // ── Talking to the Worker ────────────────────────────────────────────

    function handleBlock(block, onEvent) {
        var event = 'message';
        var data = '';
        block.split('\n').forEach(function(line) {
            if (line.indexOf('event:') === 0) event = line.slice(6).trim();
            else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
        });
        if (!data) return;
        var parsed;
        try { parsed = JSON.parse(data); } catch (error) { return; }
        onEvent(event, parsed);
    }

    function readEvents(response, onEvent) {
        var buffer = '';
        function drain() {
            var end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
                handleBlock(buffer.slice(0, end), onEvent);
                buffer = buffer.slice(end + 2);
            }
        }
        if (!response.body || !response.body.getReader || !window.TextDecoder) {
            return response.text().then(function(text) { buffer = text + '\n\n'; drain(); });
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        function pump() {
            return reader.read().then(function(result) {
                if (result.done) {
                    buffer += decoder.decode() + '\n\n';
                    drain();
                    return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                drain();
                return pump();
            });
        }
        return pump();
    }

    function historyTurns(exchanges) {
        var turns = [];
        exchanges.filter(function(e) { return e.answer && !e.error; })
            .slice(-MAX_HISTORY_EXCHANGES)
            .forEach(function(e) {
                turns.push({ role: 'user', text: e.question });
                turns.push({ role: 'assistant', text: e.answer });
            });
        return turns;
    }

    function failureMessage(status) {
        if (status === 429) return 'The assistant is busy. Please wait a minute and try again.';
        if (status === 403) return 'The assistant only answers questions asked on this site.';
        return 'The assistant couldn’t answer just now. Please try again.';
    }

    // The model names and data notice come from the Worker, so they always match
    // the model it is actually configured with. Asked once per page load.
    var infoRequest = null;
    function info() {
        if (!infoRequest) {
            infoRequest = fetch(assistantUrl() + '/info').then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            });
        }
        return infoRequest;
    }

    // ── An Ask view: the /ask/ page, or the side panel ───────────────────

    function createView(root) {
        var state = {
            root: root,
            api: assistantUrl(),
            form: root.querySelector('.ask__form'),
            input: root.querySelector('.ask__form input'),
            submit: root.querySelector('.ask__form button[type="submit"]'),
            status: root.querySelector('.ask__status'),
            conversation: root.querySelector('.ask__conversation'),
            notice: root.querySelector('.ask__data-notice'),
            aboutChip: root.querySelector('.ask__about'),
            aboutLabel: root.querySelector('.ask__about-label'),
            examples: root.querySelector('.ask__examples'),
            reset: root.querySelector('.ask__reset'),
            unavailable: root.querySelector('.ask__unavailable'),
            exchanges: [],
            about: null,
            busy: false
        };

        function setStatus(message) {
            state.status.textContent = message || '';
        }

        function setBusy(busy) {
            state.busy = busy;
            state.input.disabled = busy;
            state.submit.disabled = busy;
            state.submit.textContent = busy ? 'Answering…' : 'Ask';
            state.root.setAttribute('data-state', busy ? 'busy' : 'idle');
        }

        function setAbout(reference) {
            state.about = reference || null;
            state.aboutChip.hidden = !state.about;
            if (state.about) state.aboutLabel.textContent = state.about;
        }

        function refreshControls() {
            var started = state.exchanges.length > 0;
            state.reset.hidden = !started;
            state.examples.hidden = started || state.form.hidden;
            state.input.placeholder = started
                ? 'Ask a follow-up question'
                : 'e.g. Can a Christian lose their salvation?';
        }

        // Re-render from sessionStorage, which the other view may have changed.
        // Not mid-answer: that would drop the exchange being written.
        function reload() {
            if (state.busy) return;
            state.exchanges = [];
            state.conversation.textContent = '';
            (load() || []).forEach(function(exchange) {
                state.exchanges.push(exchange);
                state.conversation.appendChild(renderExchange(exchange).root);
            });
            refreshControls();
        }

        function ask(question) {
            if (state.busy) {
                state.input.value = question;
                return;
            }
            var exchange = {
                question: question,
                about: state.about,
                answer: '',
                sources: [],
                model: '',
                fallback: false,
                error: ''
            };
            var body = { question: question, history: historyTurns(state.exchanges) };
            if (state.about) body.about = state.about;
            setAbout(null);

            var view = renderExchange(exchange);
            view.answer.setAttribute('aria-busy', 'true');
            state.conversation.appendChild(view.root);
            setBusy(true);
            setStatus('Finding the sections that bear on your question…');
            view.root.scrollIntoView({ behavior: 'smooth', block: 'start' });

            var pending = false;
            function scheduleUpdate() {
                if (pending) return;
                pending = true;
                (window.requestAnimationFrame || setTimeout)(function() {
                    pending = false;
                    update(view, exchange);
                });
            }

            fetch(state.api + '/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().catch(function() { return {}; }).then(function(error) {
                        exchange.error = error.message || failureMessage(response.status);
                    });
                }
                return readEvents(response, function(event, data) {
                    if (event === 'status') {
                        setStatus(data.message);
                    } else if (event === 'sources') {
                        exchange.sources = data;
                        scheduleUpdate();
                    } else if (event === 'text') {
                        if (!exchange.answer) setStatus('Writing the answer…');
                        exchange.answer += data.delta;
                        scheduleUpdate();
                    } else if (event === 'done') {
                        exchange.model = data.model;
                        exchange.fallback = !!data.fallback;
                    } else if (event === 'error') {
                        exchange.error = data.message || failureMessage(0);
                    }
                }).then(function() {
                    if (!exchange.answer && !exchange.error) exchange.error = failureMessage(0);
                });
            }).catch(function() {
                exchange.error = 'The assistant couldn’t be reached. Check your connection and try again.';
            }).then(function() {
                view.answer.removeAttribute('aria-busy');
                update(view, exchange);
                state.exchanges.push(exchange);
                save(state.exchanges);
                setBusy(false);
                refreshControls();
                setStatus(exchange.error ? exchange.error : 'Answer ready.');
                if (!state.root.closest('[hidden]')) state.input.focus();
            });
        }

        function showUnavailable() {
            state.form.hidden = true;
            state.examples.hidden = true;
            state.unavailable.hidden = false;
        }

        var api = {
            root: root,
            ask: ask,
            setAbout: setAbout,
            reload: reload,
            focus: function() { state.input.focus(); },
            isBusy: function() { return state.busy; }
        };

        if (!state.api || !window.fetch) {
            showUnavailable();
            return api;
        }

        info().then(function(details) {
            if (details.notice) state.notice.textContent = details.notice;
        }).catch(showUnavailable);

        reload();

        state.form.addEventListener('submit', function(event) {
            event.preventDefault();
            var question = state.input.value.trim();
            if (!question || state.busy) return;
            state.input.value = '';
            ask(question);
        });

        root.querySelector('.ask__about-clear').addEventListener('click', function() {
            setAbout(null);
            state.input.focus();
        });

        state.examples.addEventListener('click', function(event) {
            var button = event.target.closest('button');
            if (!button || state.busy) return;
            ask(button.textContent.trim());
        });

        state.reset.addEventListener('click', function() {
            state.exchanges = [];
            forget();
            state.conversation.textContent = '';
            setStatus('');
            refreshControls();
            state.input.focus();
        });

        return api;
    }

    // ── The /ask/ page ───────────────────────────────────────────────────

    function isAskPage() {
        return /\/ask\/(?:index\.html)?$/.test(location.pathname);
    }

    function initPage() {
        var root = document.querySelector('.page-inner .ask');
        if (!root || root.getAttribute('data-ready')) return;
        root.setAttribute('data-ready', 'true');
        var view = createView(root);

        var params = new URLSearchParams(location.search);
        view.setAbout(params.get('about'));

        // Arriving from a link to /ask/?question=… (the panel intercepts these,
        // but a new tab or a reload lands here): ask it straight away, and drop
        // ?question= so a reload doesn't ask it twice. Not ?q=: search.js treats
        // ?q= on any page as a search to reopen.
        var question = (params.get('question') || '').trim().slice(0, 1000);
        if (question) {
            params.delete('question');
            var rest = params.toString();
            if (window.history && window.history.replaceState) {
                window.history.replaceState({}, '', location.pathname + (rest ? '?' + rest : ''));
            }
            view.ask(question);
        }
    }

    // ── The side panel ───────────────────────────────────────────────────

    var panel = null;

    function panelAvailable() {
        return !!(assistantUrl() && window.fetch && document.getElementById('ask-panel-template')) &&
            !isAskPage();
    }

    function isPhone() {
        return window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    }

    // The panel sits outside .book, where the theme's colour and font classes
    // live, so it copies them. The .book element is replaced on every page swap,
    // hence watchBook() re-attaches the observer on page.change.
    var THEME_CLASSES = /\b(?:color-theme|font-family|font-size)-\d+\b/g;
    function syncTheme() {
        if (!panel) return;
        var book = document.querySelector('.book');
        var wanted = book ? (book.className.match(THEME_CLASSES) || []) : [];
        var kept = panel.element.className.replace(THEME_CLASSES, ' ').replace(/\s+/g, ' ').trim();
        panel.element.className = (kept + ' ' + wanted.join(' ')).trim();
    }
    var bookObserver = window.MutationObserver ? new MutationObserver(syncTheme) : null;
    function watchBook() {
        if (!bookObserver) return;
        bookObserver.disconnect();
        var book = document.querySelector('.book');
        if (book) bookObserver.observe(book, { attributes: true, attributeFilter: ['class'] });
        syncTheme();
    }

    function syncToolbar() {
        var open = !!(panel && !panel.element.hidden);
        $('.reader-action-ask').attr({ 'aria-controls': 'ask-panel', 'aria-expanded': open ? 'true' : 'false' });
    }

    // The page's width changes when the panel opens or closes; theme.js lays
    // out some things on resize, so give it one after the transition.
    function afterLayoutChange() {
        setTimeout(function() {
            try { window.dispatchEvent(new Event('resize')); } catch (error) { /* old browsers */ }
        }, 300);
    }

    // Load another page the way theme.js does for links in the text: it swaps
    // pages in place for any link inside .page-inner, replacing only .book, so
    // the panel stays. A plain click on a temporary anchor there borrows that;
    // if nothing intercepts it, the anchor simply navigates.
    function goTo(href) {
        var inner = document.querySelector('.page-inner');
        if (!inner) {
            location.href = href;
            return;
        }
        var anchor = document.createElement('a');
        anchor.href = href;
        anchor.hidden = true;
        inner.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }

    function isPlainClick(event, link) {
        return event.button === 0 && !event.defaultPrevented && !link.target &&
            !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
    }

    function onPanelLinkClick(event) {
        var link = event.target.closest && event.target.closest('a[href]');
        if (!link || !isPlainClick(event, link)) return;
        var url = new URL(link.href, location.href);
        if (url.origin !== location.origin) return;
        // On a phone the panel covers the page: get it out of the way.
        if (isPhone()) closePanel(false);
        // The same page: the browser scrolls to the fragment, and custom.js's
        // hashchange handler highlights the section.
        if (url.pathname === location.pathname) return;
        event.preventDefault();
        goTo(url.pathname + url.search + url.hash);
    }

    function ensurePanel() {
        if (panel) return panel;
        var template = document.getElementById('ask-panel-template');
        if (!template || !template.content || !template.content.firstElementChild) return null;
        var element = template.content.firstElementChild.cloneNode(true);
        document.body.appendChild(element);
        var root = element.querySelector('.ask');
        root.setAttribute('data-ready', 'true');
        panel = { element: element, view: createView(root) };

        element.querySelector('.ask-panel__close').addEventListener('click', function() {
            closePanel(true);
        });
        element.addEventListener('keydown', function(event) {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closePanel(true);
        });
        element.addEventListener('click', onPanelLinkClick);
        watchBook();
        return panel;
    }

    function showPanel() {
        panel.element.hidden = false;
        document.body.classList.add('ask-panel-open');
        syncToolbar();
        afterLayoutChange();
    }

    function hidePanel() {
        panel.element.hidden = true;
        document.body.classList.remove('ask-panel-open');
        syncToolbar();
        afterLayoutChange();
    }

    // options.about: the section the reader is looking at (null clears it).
    // options.question: ask it straight away.
    // options.focus: false when restoring the panel after a reload.
    function openPanel(options) {
        options = options || {};
        if (!panelAvailable() || !ensurePanel()) return false;
        if (panel.element.hidden) {
            panel.view.reload();
            showPanel();
        }
        sessionSet(PANEL_KEY, '1');
        if (options.about !== undefined) panel.view.setAbout(options.about);
        if (options.question) panel.view.ask(String(options.question).slice(0, 1000));
        else if (options.focus !== false) panel.view.focus();
        return true;
    }

    function closePanel(returnFocus) {
        if (!panel || panel.element.hidden) return;
        hidePanel();
        sessionSet(PANEL_KEY, null);
        if (!returnFocus) return;
        var button = $('.reader-action-ask').filter(function() { return this.offsetParent !== null; }).get(0);
        if (button) button.focus();
    }

    window.ccAsk = {
        available: panelAvailable,
        open: openPanel,
        close: function() { closePanel(false); }
    };

    // The search page's "Ask this as a question" and the homepage's Ask link
    // open the panel. Capture phase, because theme.js's own handler for links
    // in .page-inner would otherwise navigate first. A new-tab click still
    // reaches /ask/.
    document.addEventListener('click', function(event) {
        var link = event.target.closest && event.target.closest('a.cc-search__ask-link, .home-ask a');
        if (!link || !isPlainClick(event, link) || !panelAvailable()) return;
        event.preventDefault();
        event.stopPropagation();
        var question = new URL(link.href, location.href).searchParams.get('question');
        openPanel({ question: question || undefined });
    }, true);

    var lastPath = null;
    function onPageChange() {
        initPage();
        var moved = lastPath !== null && lastPath !== location.pathname;
        lastPath = location.pathname;

        if (isAskPage()) {
            // The page has its own Ask; the panel steps aside without forgetting
            // it was open.
            if (panel && !panel.element.hidden) hidePanel();
            return;
        }
        if (!panelAvailable() || !ensurePanel()) return;
        watchBook();
        // The About chip named a section of the page the reader has left.
        if (moved) panel.view.setAbout(null);
        if (panel.element.hidden && sessionGet(PANEL_KEY) === '1') openPanel({ focus: false });
        syncToolbar();
    }

    gitbook.events.bind('page.change', onPageChange);
    $(onPageChange);
});
