// Enable footnote link support for pages with width < 1240.
//
function bind_footnote_links() {
    if ($(document).width() > 1240) {
        return;
    }
    let footnotes = $("div.footnotes").find("ol > li > p > a.reversefootnote");
    for (let i = 0; i < footnotes.length; i++) {
        let footnote = footnotes[i];
        footnote.addEventListener('click', function(e) {
            e.preventDefault();
            var target = $($(this).attr('href'));
            if (target.length) {
                $('div.body-inner').animate({
                    scrollTop: target.get(0).offsetTop,
                });
            }
        });
    }
}

if (document.readyState === "loading") {
    // Loading hasn't finished yet
    document.addEventListener("DOMContentLoaded", bind_footnote_links);
} else {
    // `DOMContentLoaded` has already fired
    bind_footnote_links();
}

require(['gitbook', 'jquery'], function(gitbook, $) {

    // ── Safe localStorage access ───────────────────────────────────────────
    // Safari private mode and storage-blocked contexts throw on access; an
    // uncaught error here would abort the whole callback and disable every
    // toolbar button, so read/write defensively.
    function lsGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function lsSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
    }

    // ── State ──────────────────────────────────────────────────────────────
    var showModern = lsGet('mesv-version') === 'modern';
    var highlightOn = lsGet('mesv-highlight') === 'on';

    // ── Helpers ────────────────────────────────────────────────────────────
    function isStandardsPage() {
        // Only apply version toggle on WCF, WSC, WLC pages
        return $('span[id^="wcf-"], span[id^="wsc-q"], span[id^="wlc-q"]').length > 0;
    }

    function getContainer() {
        return $('.book-body');
    }

    function applyVersionState() {
        var $c = getContainer();
        if (showModern) {
            $c.addClass('show-modern');
        } else {
            $c.removeClass('show-modern').removeClass('highlight-changes');
        }
        if (showModern && highlightOn) {
            $c.addClass('highlight-changes');
        }
        updateIndicator();
    }

    function updateIndicator() {
        if (!isStandardsPage()) return;
        var $ind = $('#mesv-version-indicator');
        if ($ind.length === 0) {
            $ind = $('<p id="mesv-version-indicator"></p>');
            // Insert after the first h2 or h1 on the page, or at top of page-inner
            var $inner = $('.page-inner');
            var $firstHeading = $inner.find('h1, h2').first();
            if ($firstHeading.length) {
                $firstHeading.after($ind);
            } else {
                $inner.prepend($ind);
            }
        }
        if (showModern) {
            $ind.text('Viewing: 2025 Modern English Study Version (MESV) — for study purposes only; carries no constitutional authority');
        }
    }

    function showToast(msg) {
        var toast = $('<div id="copy-toast" role="status" aria-live="polite"></div>').text(msg);
        $('body').append(toast);
        setTimeout(function() { toast.addClass('show'); }, 10);
        setTimeout(function() {
            toast.removeClass('show');
            setTimeout(function() { toast.remove(); }, 300);
        }, 2000);
    }

    // ── Re-tag Bible references after GitBook AJAX page navigation ──────────
    // GitBook swaps page content in via XMLHttpRequest without a full reload,
    // so RefTagger (which auto-runs only once on first load) never re-scans
    // the new content. Re-invoke refTagger.tag() on every page change.
    function retagReferences() {
        if (window.refTagger && typeof window.refTagger.tag === 'function') {
            try {
                window.refTagger.tag();
            } catch (e) {
                // A RefTagger internal error must not break page.change handling.
            }
        }
    }

    // ── Re-tag when a Scripture Proofs callout is expanded ─────────────────
    // Every scripture reference lives inside a collapsed <details> callout.
    // RefTagger only tags *rendered* text (via innerText), so references
    // hidden in a closed <details> are never seen on the initial scan. When a
    // callout opens, its references become visible for the first time, so
    // re-run RefTagger to tag them. The 'toggle' event does not bubble, so we
    // listen in the capture phase at the document level; this one listener
    // also covers callouts inserted later by GitBook's AJAX navigation.
    document.addEventListener('toggle', function(e) {
        var el = e.target;
        if (el && el.tagName === 'DETAILS' && el.open &&
            el.classList.contains('scripture-proofs')) {
            retagReferences();
        }
    }, true);

    // ── Open a Scripture Proofs callout when a proof marker links to it ─────
    // Every lettered marker in the text is an anchor pointing at its section's
    // callout. Browsers expand a closed <details> only when the fragment target
    // is *inside* it — here the target is the <details> itself, so nothing would
    // happen. Open it explicitly, then flash it so the destination is visible
    // even when the page scrolls very little.
    function revealProofs(id) {
        if (!id) return false;
        var el = document.getElementById(id);
        if (!el || el.tagName !== 'DETAILS' ||
            !el.classList.contains('scripture-proofs')) {
            return false;
        }
        el.open = true;                      // fires 'toggle' -> re-tags references
        el.classList.remove('proof-target');
        void el.offsetWidth;                 // restart the flash if re-clicked
        el.classList.add('proof-target');
        return true;
    }

    // Delegated so it also covers content GitBook swaps in via AJAX.
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest
            ? e.target.closest('sup.proof-marker > a[href^="#"]')
            : null;
        if (!a) return;
        revealProofs(a.getAttribute('href').slice(1));
        // Let the browser handle scrolling and the history entry.
    });

    // Deep links straight to a callout (shared or reloaded) must open it too.
    window.addEventListener('hashchange', function() {
        revealProofs(location.hash.slice(1));
    });

    // ── Page load: restore state ───────────────────────────────────────────
    gitbook.events.bind('page.change', function() {
        applyVersionState();
        // RefTagger.js may still be loading on the very first page.change;
        // a short retry covers that race without blocking later navigations.
        retagReferences();
        setTimeout(retagReferences, 600);
        // Landing directly on a callout URL: no hashchange fires for the
        // fragment the page loaded with, so handle it here.
        revealProofs(location.hash.slice(1));
    });

    // ── Toolbar Buttons ────────────────────────────────────────────────────
    gitbook.events.bind('start', function() {

        // Copy Link button
        gitbook.toolbar.createButton({
            icon: 'fa fa-clipboard',
            label: 'Copy link',
            position: 'right',
            onClick: function(e) {
                e.preventDefault();
                navigator.clipboard.writeText(location.href).then(function() {
                    showToast('Link copied!');
                }).catch(function() {
                    showToast('Could not copy link');
                });
            }
        });

        // Version Toggle button
        gitbook.toolbar.createButton({
            icon: 'fa fa-language',
            label: 'Toggle MESV / Constitutional',
            position: 'right',
            onClick: function(e) {
                e.preventDefault();
                if (!isStandardsPage()) {
                    showToast('Version toggle only available on WCF, WSC, and WLC pages');
                    return;
                }
                showModern = !showModern;
                if (!showModern) highlightOn = false;
                lsSet('mesv-version', showModern ? 'modern' : 'constitutional');
                lsSet('mesv-highlight', highlightOn ? 'on' : 'off');
                applyVersionState();
                showToast(showModern
                    ? 'Showing: 2025 Modern English Study Version'
                    : 'Showing: Constitutional Text');
            }
        });

        // Highlight Changes button
        gitbook.toolbar.createButton({
            icon: 'fa fa-paint-brush',
            label: 'Highlight Changes',
            position: 'right',
            onClick: function(e) {
                e.preventDefault();
                if (!isStandardsPage()) return;
                if (!showModern) {
                    showToast('Switch to Modern English version first');
                    return;
                }
                highlightOn = !highlightOn;
                lsSet('mesv-highlight', highlightOn ? 'on' : 'off');
                getContainer().toggleClass('highlight-changes', highlightOn);
                showToast(highlightOn ? 'Highlighting changes from constitutional text' : 'Highlights off');
            }
        });

        // Restore state on initial load
        applyVersionState();
    });

});

