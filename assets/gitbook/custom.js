// Keep reverse-footnote scrolling inside GitBook's independently scrolling body.
function bind_footnote_links() {
    if ($(document).width() > 1240) return;
    $('div.footnotes ol > li > p > a.reversefootnote').each(function() {
        this.addEventListener('click', function(event) {
            event.preventDefault();
            var target = $($(this).attr('href'));
            if (target.length) {
                $('div.body-inner').animate({ scrollTop: target.get(0).offsetTop });
            }
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind_footnote_links);
} else {
    bind_footnote_links();
}

require(['gitbook', 'jquery'], function(gitbook, $) {
    'use strict';

    function lsGet(key) {
        try { return localStorage.getItem(key); } catch (error) { return null; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, value); } catch (error) { /* ignore */ }
    }

    var showModern = lsGet('mesv-version') === 'modern';
    var highlightOn = lsGet('mesv-highlight') === 'on';

    function isStandardsPage() {
        return $('.text-variant').length > 0;
    }

    function showToast(message) {
        $('#copy-toast').remove();
        var toast = $('<div id="copy-toast" role="status" aria-live="polite"></div>')
            .text(message)
            .appendTo('body');
        setTimeout(function() { toast.addClass('show'); }, 10);
        setTimeout(function() {
            toast.removeClass('show');
            setTimeout(function() { toast.remove(); }, 300);
        }, 2000);
    }

    function updateControls() {
        var available = isStandardsPage();
        var versionLabel = showModern ? 'Text: MESV' : 'Text: Constitutional';
        // Hide rather than disable. A greyed-out "Text: MESV" on a creed or the
        // search page reads as a broken control; the edition only exists in the
        // Westminster Standards, so the button simply should not be there.
        $('.reader-action-version')
            .prop('hidden', !available)
            .prop('disabled', !available)
            .attr('aria-pressed', showModern ? 'true' : 'false')
            .attr('title', 'Switch text edition')
            .find('.reader-action-label').text(versionLabel);
        $('.reader-action-highlight')
            .prop('hidden', !available || !showModern)
            .prop('disabled', !available || !showModern)
            .attr('aria-pressed', highlightOn ? 'true' : 'false');
        // On the search page the toolbar's own Search button goes nowhere useful.
        $('.reader-action-search').prop('hidden', isSearchPage());
    }

    function isSearchPage() {
        return /\/search\/(?:index\.html)?$/.test(location.pathname) ||
            /\/assets\/search\.html$/.test(location.pathname);
    }

    function updateIndicator() {
        var $indicator = $('#mesv-version-indicator');
        if (!isStandardsPage()) {
            $indicator.remove();
            return;
        }
        if (!$indicator.length) {
            $indicator = $('<p id="mesv-version-indicator" role="status"></p>');
            var $panel = $('.edition-panel').first();
            ($panel.length ? $panel : $('.markdown-section h1').first()).after($indicator);
        }
        $indicator.text(showModern
            ? 'Viewing the 2025 Modern English Study Version (study use only; no constitutional authority).'
            : 'Viewing the constitutional text.');
    }

    function applyVersionState() {
        $('.text-variant').each(function() {
            if (!this.hasAttribute('data-constitutional')) {
                this.setAttribute('data-constitutional', this.textContent);
            }
            this.textContent = showModern
                ? this.getAttribute('data-modern')
                : this.getAttribute('data-constitutional');
        });
        $('.book-body')
            .toggleClass('show-modern', showModern)
            .toggleClass('highlight-changes', showModern && highlightOn);
        updateIndicator();
        updateControls();
    }

    // RefTagger is a third-party script fetched from api.reftagger.com. On a cold
    // load it can still be in flight when the first page.change fires, so poll
    // briefly rather than firing once and silently giving up.
    function retagReferences(attempt) {
        attempt = attempt || 0;
        if (window.refTagger && typeof window.refTagger.tag === 'function') {
            try { window.refTagger.tag(); } catch (error) { /* isolate vendor errors */ }
            return;
        }
        if (attempt < 20) {
            setTimeout(function() { retagReferences(attempt + 1); }, 150);
        }
    }

    function revealProofs(id) {
        if (!id) return false;
        var element = document.getElementById(id);
        if (!element || element.tagName !== 'DETAILS' ||
            !element.classList.contains('scripture-proofs')) return false;
        element.open = true;
        element.classList.remove('proof-target');
        void element.offsetWidth;
        element.classList.add('proof-target');
        return true;
    }

    document.addEventListener('toggle', function(event) {
        var element = event.target;
        if (element && element.tagName === 'DETAILS' && element.open &&
            element.classList.contains('scripture-proofs')) retagReferences();
    }, true);

    document.addEventListener('click', function(event) {
        var marker = event.target && event.target.closest
            ? event.target.closest('sup.proof-marker > a[href^="#"]')
            : null;
        if (marker) revealProofs(marker.getAttribute('href').slice(1));
    });

    window.addEventListener('hashchange', function() {
        revealProofs(location.hash.slice(1));
    });

    function button(action, icon, label, toggle) {
        var attrs = {
            type: 'button',
            'class': 'reader-action reader-action-' + action,
            title: label
        };
        if (toggle) attrs['aria-pressed'] = 'false';
        return $('<button>', attrs)
            .append($('<i>', { 'class': 'fa ' + icon, 'aria-hidden': 'true' }))
            .append($('<span>', {
                'class': 'reader-action-label',
                text: label
            }));
    }

    function toolButtons() {
        return $('<div class="reader-actions"></div>')
            .append(button('search', 'fa-search', 'Search'))
            .append(button('version', 'fa-language', 'Text: Constitutional', true))
            .append(button('highlight', 'fa-paint-brush', 'Highlight changes', true))
            .append(button('copy', 'fa-clipboard', 'Copy link'));
    }

    function installToolbar() {
        $('.site-toolbar, .mobile-tools').remove();
        var $header = $('.book-header').first();
        if (!$header.length) return;

        $('<nav>', {
            'class': 'site-toolbar',
            'aria-label': 'Reader tools'
        }).append(toolButtons()).appendTo($header);

        $('<details class="mobile-tools"></details>')
            .append($('<summary>', { text: 'Reader tools' }))
            .append(toolButtons())
            .appendTo($header);

        // Theme-owned menu control is still an anchor because it navigates the
        // sidebar state; give it an explicit accessible name and tooltip.
        $header.find('a .fa-align-justify').parent()
            .attr({ 'aria-label': 'Open navigation', title: 'Open navigation' });
        updateControls();
    }

    function installSectionSelector() {
        $('.mobile-section-nav').remove();
        var links = $('.book-summary li.chapter.active > ul a');
        if (links.length < 2) return;
        var $select = $('<select id="mobile-section-select"></select>');
        $select.append($('<option>', { value: '', text: 'Jump to a section…' }));
        links.each(function() {
            $select.append($('<option>', {
                value: this.getAttribute('href'),
                text: $(this).text().trim()
            }));
        });
        $('<nav>', {
            'class': 'mobile-section-nav',
            'aria-label': 'On this page'
        })
            .append($('<label>', {
                'for': 'mobile-section-select',
                text: 'On this page'
            }))
            .append($select)
            .insertAfter($('.edition-panel').first());
    }

    $('body').on('click', '.reader-action-search', function() {
        location.href = gitbook.state.basePath + '/search/';
    });
    $('body').on('click', '.reader-action-version', function() {
        if (!isStandardsPage()) return;
        showModern = !showModern;
        if (!showModern) highlightOn = false;
        lsSet('mesv-version', showModern ? 'modern' : 'constitutional');
        lsSet('mesv-highlight', highlightOn ? 'on' : 'off');
        applyVersionState();
        showToast(showModern ? 'Showing the 2025 MESV' : 'Showing constitutional text');
    });
    $('body').on('click', '.reader-action-highlight', function() {
        if (!isStandardsPage() || !showModern) return;
        highlightOn = !highlightOn;
        lsSet('mesv-highlight', highlightOn ? 'on' : 'off');
        applyVersionState();
        showToast(highlightOn ? 'Changes highlighted' : 'Change highlights off');
    });
    $('body').on('click', '.reader-action-copy', function() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(location.href)
                .then(function() { showToast('Link copied'); })
                .catch(function() { showToast('Could not copy link'); });
        } else {
            showToast('Copy this address: ' + location.href);
        }
    });
    $('body').on('change', '#mobile-section-select', function() {
        if (this.value) location.href = this.value;
    });

    function onPageChange() {
        installToolbar();
        installSectionSelector();
        applyVersionState();
        retagReferences();      // self-retries while the vendor script loads
        revealProofs(location.hash.slice(1));
    }

    gitbook.events.bind('start', installToolbar);
    gitbook.events.bind('page.change', onPageChange);
});
