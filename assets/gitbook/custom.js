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
        updateDisplayMenu();
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

    // ── Per-section permalinks ─────────────────────────────────────────────
    // Readers cite "WCF 11.1" or "WSC 33" and need a link to exactly that unit.
    // The ids already exist; only the affordance was missing.
    //
    // Deliberately NOT a route to the scripture proofs. Section numbers used to
    // link down to their proof callout and were removed for duplicating the
    // lettered proof markers; this control copies a citation instead.
    //
    // The reference labels mirror the derivation in assets/search_plus_index.json,
    // which builds the same strings for search result badges. Keep the two in sync.

    var DOC_PREFIX = {
        wcf: 'WCF',
        wsc: 'WSC',
        wlc: 'WLC',
        heidelberg: 'Heidelberg',
        belgic: 'Belgic'
    };

    function documentPrefix() {
        var match = location.pathname.match(/\/pages\/([a-z-]+)\//);
        return (match && DOC_PREFIX[match[1]]) || '';
    }

    // "wcf-11-1" -> "11.1";  "wsc-q33" -> "33";  otherwise null.
    function unitFromId(id) {
        var wcf = /^wcf-(\d+)-(\d+)$/.exec(id);
        if (wcf) return wcf[1] + '.' + wcf[2];
        var question = /^w(?:sc|lc)-q(\d+)$/.exec(id);
        if (question) return question[1];
        return null;
    }

    // Heidelberg/Belgic headings open with "1. …"; WCF chapters with "Chapter 1:".
    function unitFromHeading(text) {
        var chapter = /^\s*Chapter\s+(\d+)\b/i.exec(text);
        if (chapter) return chapter[1];
        var numbered = /^\s*(\d+)\s*\./.exec(text);
        return numbered ? numbered[1] : null;
    }

    function referenceFor(id, headingText) {
        var prefix = documentPrefix();
        if (!prefix) return '';
        var unit = unitFromId(id) ||
            (headingText ? unitFromHeading(headingText) : null);
        return unit ? prefix + ' ' + unit : '';
    }

    function citationFor(link) {
        var reference = link.getAttribute('data-reference') || '';
        var url = location.origin + location.pathname +
            '#' + link.getAttribute('href').slice(1);
        return reference ? reference + ' — ' + url : url;
    }

    // The control leads its heading, matching the WCF numbered paragraphs where
    // it already sits in front of the section number. Leading also removes the
    // reason the trailing version needed a word joiner: a control at the end of
    // a heading could wrap onto a line of its own when the heading filled its
    // last line, and read as a stray "#".
    //
    // referenceFor() is passed heading.textContent before the control is
    // inserted, so the "#" is not part of the text the reference is derived from.
    function prependToHeading(heading, id) {
        permalinkControl(id, referenceFor(id, heading.textContent))
            .prependTo(heading);
    }

    function permalinkControl(id, reference) {
        var label = reference
            ? 'Copy link to ' + reference
            : 'Copy link to this section';
        return $('<a>', {
            'class': 'section-permalink',
            href: '#' + id,
            'data-reference': reference,
            'aria-label': label,
            title: label,
            text: '#'
        });
    }

    function installPermalinks() {
        var $scope = $('.page-inner .markdown-section');
        if (!$scope.length) return;
        // onPageChange runs on every AJAX navigation; clear first so controls
        // are not stacked one per visit.
        $scope.find('.section-permalink').remove();

        var seen = {};

        // Anchor spans: WCF numbered paragraphs, and WSC/WLC questions whose
        // span sits in an empty <p> just before the heading.
        $scope.find('span[id]').each(function() {
            var span = this;
            var id = span.id;
            if (!id || seen[id]) return;
            var paragraph = span.parentElement;
            var heading = null;
            if (paragraph && !paragraph.textContent.trim()) {
                var next = paragraph.nextElementSibling;
                if (next && /^H[1-6]$/.test(next.tagName)) heading = next;
            }
            seen[id] = true;
            if (heading) {
                prependToHeading(heading, id);
            } else {
                // WCF: sits at the head of the numbered paragraph, beside the
                // section number it cites.
                permalinkControl(id, referenceFor(id, '')).insertAfter(span);
            }
        });

        // Everything else cites its heading. h1 is the document title, which the
        // page URL already addresses.
        $scope.find('h2[id], h3[id], h4[id]').each(function() {
            if (seen[this.id] || $(this).find('.section-permalink').length) return;
            seen[this.id] = true;
            prependToHeading(this, this.id);
        });
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

    // Display settings — text size, reading face, colour theme.
    //
    // These come from gitbook-plugin-fontsettings, which normally supplies its
    // own toolbar dropdown. It cannot here: theme.js inserts any button created
    // without an explicit `index` with `insertBefore($('.book-header').find('h1'))`,
    // and this site's header title is a <p class="book-header-title">, not an
    // <h1> (a second h1 per page would be wrong, and script/check-generated-html.py
    // enforces exactly one). With no h1 to insert before, the Font Settings
    // dropdown was created and then silently dropped — the sidebar toggle
    // survived only because it passes index: 0, which takes a different path.
    //
    // Rather than reintroduce the h1, drive the plugin's public API from this
    // toolbar. gitbook.fontsettings exposes everything needed; note that
    // enlargeFontSize/reduceFontSize call preventDefault() unconditionally, so
    // they must be handed a real event.
    var FAMILY_OPTIONS = [
        { config: 'serif', label: 'Serif' },
        { config: 'sans', label: 'Sans' }
    ];
    var THEME_OPTIONS = [
        { config: 'white', label: 'Light' },
        { config: 'sepia', label: 'Sepia' },
        { config: 'night', label: 'Night' }
    ];

    function displayOption(group, config, label) {
        return $('<button>', {
            type: 'button',
            'class': 'reader-display__option',
            'data-group': group,
            'data-config': config,
            'aria-pressed': 'false',
            text: label
        });
    }

    function displayGroup(name, group, options) {
        var $row = $('<div class="reader-display__row"></div>')
            .append($('<span class="reader-display__name"></span>').text(name));
        var $set = $('<div class="reader-display__set" role="group"></div>')
            .attr('aria-label', name);
        options.forEach(function(option) {
            $set.append(displayOption(group, option.config, option.label));
        });
        return $row.append($set);
    }

    function displayMenu() {
        var $panel = $('<div class="reader-display__panel"></div>')
            .append(
                $('<div class="reader-display__row"></div>')
                    .append($('<span class="reader-display__name">Text size</span>'))
                    .append($('<div class="reader-display__set" role="group" aria-label="Text size"></div>')
                        .append($('<button>', {
                            type: 'button',
                            'class': 'reader-display__option reader-display__size',
                            'data-step': 'smaller',
                            title: 'Smaller text',
                            html: '<span aria-hidden="true">A</span>'
                        }).attr('aria-label', 'Smaller text'))
                        .append($('<button>', {
                            type: 'button',
                            'class': 'reader-display__option reader-display__size reader-display__size--large',
                            'data-step': 'larger',
                            title: 'Larger text',
                            html: '<span aria-hidden="true">A</span>'
                        }).attr('aria-label', 'Larger text')))
            )
            .append(displayGroup('Face', 'family', FAMILY_OPTIONS))
            .append(displayGroup('Theme', 'theme', THEME_OPTIONS));

        return $('<details class="reader-display"></details>')
            .append($('<summary>')
                .attr('title', 'Display settings')
                .append($('<i>', { 'class': 'fa fa-font', 'aria-hidden': 'true' }))
                .append($('<span class="reader-action-label">Display</span>')))
            .append($panel);
    }

    // The plugin keeps its state only in the classes it puts on .book, so read
    // the active option back from there rather than duplicating the state.
    function displayState() {
        var classes = $('.book').attr('class') || '';
        var family = /\bfont-family-(\d)\b/.exec(classes);
        var theme = /\bcolor-theme-(\d)\b/.exec(classes);
        return {
            family: family ? Number(family[1]) : 0,
            // No color-theme class at all is theme 0 (white); the plugin only
            // adds the class for the non-default themes.
            theme: theme ? Number(theme[1]) : 0
        };
    }

    function updateDisplayMenu() {
        var state = displayState();
        $('.reader-display__option[data-group="family"]').each(function() {
            var index = indexOfConfig(FAMILY_OPTIONS, this.getAttribute('data-config'));
            this.setAttribute('aria-pressed', index === state.family ? 'true' : 'false');
        });
        $('.reader-display__option[data-group="theme"]').each(function() {
            var index = indexOfConfig(THEME_OPTIONS, this.getAttribute('data-config'));
            this.setAttribute('aria-pressed', index === state.theme ? 'true' : 'false');
        });
    }

    function indexOfConfig(options, config) {
        for (var i = 0; i < options.length; i++) {
            if (options[i].config === config) return i;
        }
        return -1;
    }

    function toolButtons() {
        return $('<div class="reader-actions"></div>')
            .append(button('search', 'fa-search', 'Search'))
            .append(button('version', 'fa-language', 'Text: Constitutional', true))
            .append(button('highlight', 'fa-paint-brush', 'Highlight changes', true))
            .append(displayMenu())
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

    $('body').on('click', '.reader-display__size', function(event) {
        if (!window.gitbook || !gitbook.fontsettings) return;
        if (this.getAttribute('data-step') === 'larger') {
            gitbook.fontsettings.enlargeFontSize(event);
        } else {
            gitbook.fontsettings.reduceFontSize(event);
        }
    });

    $('body').on('click', '.reader-display__option[data-group]', function(event) {
        if (!window.gitbook || !gitbook.fontsettings) return;
        var config = this.getAttribute('data-config');
        if (this.getAttribute('data-group') === 'family') {
            gitbook.fontsettings.setFamily(config, event);
        } else {
            gitbook.fontsettings.setTheme(config, event);
        }
        updateDisplayMenu();
    });

    // Close the menu on an outside click or Escape, the way a dropdown should.
    $(document).on('click', function(event) {
        if ($(event.target).closest('.reader-display').length) return;
        $('.reader-display').removeAttr('open');
    });

    $(document).on('keydown', function(event) {
        if (event.key === 'Escape') $('.reader-display').removeAttr('open');
    });

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
    function copyText(text, confirmation) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function() { showToast(confirmation); })
                .catch(function() { showToast('Could not copy'); });
        } else {
            // Non-secure contexts have no async clipboard; show the text so it
            // can still be copied by hand.
            showToast(text);
        }
    }

    // The section whose permalink is nearest the top of the reading area, so the
    // toolbar copies what the reader is actually looking at rather than the whole
    // 24,000-word document.
    function currentSectionLink() {
        var best = null;
        var bestDistance = Infinity;
        $('.page-inner .section-permalink').each(function() {
            var top = this.getBoundingClientRect().top;
            var distance = top < 0 ? -top * 0.25 : top;   // prefer what is above
            if (distance < bestDistance) {
                bestDistance = distance;
                best = this;
            }
        });
        return best;
    }

    $('body').on('click', '.section-permalink', function(event) {
        event.preventDefault();
        var reference = this.getAttribute('data-reference');
        // Keep the address bar in step, so copying from there works too.
        if (history.replaceState) {
            history.replaceState({}, '', this.getAttribute('href'));
        }
        copyText(citationFor(this),
            reference ? 'Copied citation for ' + reference : 'Link copied');
    });

    $('body').on('click', '.reader-action-copy', function() {
        var link = currentSectionLink();
        if (!link) {
            copyText(location.href, 'Link copied');
            return;
        }
        var reference = link.getAttribute('data-reference');
        copyText(citationFor(link),
            reference ? 'Copied citation for ' + reference : 'Link copied');
    });
    $('body').on('change', '#mobile-section-select', function() {
        if (this.value) location.href = this.value;
    });

    function onPageChange() {
        installToolbar();
        installSectionSelector();
        installPermalinks();
        applyVersionState();
        retagReferences();      // self-retries while the vendor script loads
        revealProofs(location.hash.slice(1));
    }

    gitbook.events.bind('start', installToolbar);
    gitbook.events.bind('page.change', onPageChange);
});
