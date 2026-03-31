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

    // ── State ──────────────────────────────────────────────────────────────
    var showModern = localStorage.getItem('mesv-version') === 'modern';
    var highlightOn = localStorage.getItem('mesv-highlight') === 'on';

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
        var toast = $('<div id="copy-toast">' + msg + '</div>');
        $('body').append(toast);
        setTimeout(function() { toast.addClass('show'); }, 10);
        setTimeout(function() {
            toast.removeClass('show');
            setTimeout(function() { toast.remove(); }, 300);
        }, 2000);
    }

    // ── Page load: restore state ───────────────────────────────────────────
    gitbook.events.bind('page.change', function() {
        applyVersionState();
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
                localStorage.setItem('mesv-version', showModern ? 'modern' : 'constitutional');
                localStorage.setItem('mesv-highlight', highlightOn ? 'on' : 'off');
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
                localStorage.setItem('mesv-highlight', highlightOn ? 'on' : 'off');
                getContainer().toggleClass('highlight-changes', highlightOn);
                showToast(highlightOn ? 'Highlighting changes from constitutional text' : 'Highlights off');
            }
        });

        // Restore state on initial load
        applyVersionState();
    });

});

