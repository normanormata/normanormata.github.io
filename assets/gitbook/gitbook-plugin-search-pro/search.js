require(['gitbook', 'jquery'], function(gitbook, $) {
    'use strict';

    var state = gitbook.state;
    var INDEX_DATA = {};
    var indexRequest = null;
    var currentQuery = '';
    // Which document chip is selected, '' for all. Replaces the old document
    // <select>, which duplicated the result group headers.
    var activeDocument = '';
    // Don't search until there are at least this many characters. A single
    // letter matches almost every entry, which is slow and looks like noise.
    var MIN_QUERY = 2;
    var REFERENCE_QUERY = /^(?:wcf\s+\d+\.\d+|wsc\s+\d+|wlc\s+\d+|heidelberg\s+\d+)$/i;
    var INPUTS = [
        '#book-search-input input',
        '#book-search-input-inside input',
        '#home-search-input',
        '#search-page-input'
    ].join(', ');

    function escapeReg(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function escapeHtml(value) {
        return $('<div>').text(value == null ? '' : value).html();
    }

    function labelCollection(value) {
        return String(value || 'general')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, function(letter) { return letter.toUpperCase(); });
    }

    function isSearchPage() {
        return /\/search\/(?:index\.html)?$/.test(location.pathname) ||
            /\/assets\/search\.html$/.test(location.pathname);
    }

    function loadIndex() {
        if (Object.keys(INDEX_DATA).length) {
            return Promise.resolve(INDEX_DATA);
        }
        if (!indexRequest) {
            var url = state.basePath + '/assets/search_plus_index.json';
            indexRequest = window.fetch(url, { credentials: 'same-origin' })
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    return response.json();
                }).then(function(data) {
                INDEX_DATA = data;
                populateFilters();
                return data;
            }).catch(function(error) {
                $('.cc-search').attr('aria-busy', 'false');
                $('body').removeClass('search-loading');
                if (window.console) {
                    console.error('Search index failed to load: ' + url, error);
                }
            });
        }
        return indexRequest;
    }

    function populateFilters() {
        var collections = {};
        Object.keys(INDEX_DATA).forEach(function(key) {
            collections[INDEX_DATA[key].collection || 'general'] = true;
        });

        var $collection = $('#search-collection-filter');
        var selectedCollection = $collection.val();
        $collection.find('option').slice(1).remove();
        Object.keys(collections).sort().forEach(function(value) {
            $('<option>', {
                value: value,
                text: labelCollection(value)
            }).appendTo($collection);
        });
        $collection.val(selectedCollection || '');
    }

    function makeSnippet(text, query) {
        var source = String(text || '');
        var lower = source.toLocaleLowerCase();
        var index = lower.indexOf(query.toLocaleLowerCase());
        var contextBefore = 72;
        var maxLength = 250;
        var start = Math.max(0, index - contextBefore);
        var end = Math.min(source.length, start + maxLength);
        var snippet = source.slice(start, end);

        if (start > 0) {
            var firstSpace = snippet.indexOf(' ');
            if (firstSpace > -1) snippet = snippet.slice(firstSpace + 1);
            snippet = '…' + snippet;
        }
        if (end < source.length) {
            var lastSpace = snippet.lastIndexOf(' ');
            if (lastSpace > -1) snippet = snippet.slice(0, lastSpace);
            snippet += '…';
        }

        var safe = escapeHtml(snippet);
        // A proof-only match is flagged by the row's "proof" badge rather than an
        // inline prefix, which used to sit at the same size as the snippet text.
        return safe.replace(
            new RegExp('(' + escapeReg(escapeHtml(query)) + ')', 'gi'),
            '<mark class="search-highlight-keyword">$1</mark>'
        );
    }

    function runQuery(query) {
        query = String(query || '').trim();
        currentQuery = query;
        if (!query) {
            closeSearch();
            return;
        }

        var collection = $('#search-collection-filter').val() || '';
        var documentName = activeDocument;
        var lowered = query.toLocaleLowerCase();
        var exactReference = REFERENCE_QUERY.test(query);
        var results = [];

        Object.keys(INDEX_DATA).forEach(function(key) {
            var item = INDEX_DATA[key];
            if (collection && item.collection !== collection) return;
            if (documentName && item.document !== documentName) return;

            var bodyIndex = String(item.body || '').toLocaleLowerCase().indexOf(lowered);
            var proofIndex = String(item.proofs || '').toLocaleLowerCase().indexOf(lowered);
            var meta = [item.keywords, item.title, item.document].join(' ');
            var metaIndex = meta.toLocaleLowerCase().indexOf(lowered);
            var keywordWords = ' ' + String(item.keywords || '').toLocaleLowerCase() + ' ';
            if (exactReference &&
                keywordWords.indexOf(' ' + lowered + ' ') === -1) return;
            if (bodyIndex === -1 && proofIndex === -1 && metaIndex === -1) return;

            var proofMatch = bodyIndex === -1 && proofIndex !== -1;
            var snippetSource = proofMatch ? item.proofs : item.body;
            results.push({
                url: item.url || key,
                title: item.title,
                document: item.document,
                collection: item.collection,
                order: typeof item.order === 'number' ? item.order : 99,
                reference: item.reference || '',
                label: item.label || '',
                proofMatch: proofMatch,
                snippet: makeSnippet(snippetSource, query),
                score: String(item.keywords || '').toLocaleLowerCase() === lowered ? 0 :
                    (String(item.keywords || '').toLocaleLowerCase().indexOf(lowered) !== -1 ? 1 :
                    (bodyIndex !== -1 ? 2 : 3))
            });
        });

        results.sort(function(a, b) {
            return a.score - b.score || a.title.localeCompare(b.title);
        });
        displayResults(query, results, countByDocument(query, collection));
    }

    // Chip counts ignore the active document filter, so the chips still show how
    // many hits the other documents hold while one of them is selected.
    function countByDocument(query, collection) {
        var lowered = String(query || '').toLocaleLowerCase();
        var exactReference = REFERENCE_QUERY.test(query);
        var counts = [];
        var byName = {};
        Object.keys(INDEX_DATA).forEach(function(key) {
            var item = INDEX_DATA[key];
            if (collection && item.collection !== collection) return;
            var keywordWords = ' ' + String(item.keywords || '').toLocaleLowerCase() + ' ';
            if (exactReference && keywordWords.indexOf(' ' + lowered + ' ') === -1) return;
            var haystack = [item.body, item.proofs, item.keywords, item.title, item.document]
                .join(' ').toLocaleLowerCase();
            if (haystack.indexOf(lowered) === -1) return;
            var name = item.document || item.title;
            if (!byName[name]) {
                byName[name] = { name: name, count: 0,
                    order: typeof item.order === 'number' ? item.order : 99 };
                counts.push(byName[name]);
            }
            byName[name].count += 1;
        });
        return counts.sort(function(a, b) { return a.order - b.order; });
    }

    function groupByDocument(results) {
        var groups = [];
        var byName = {};
        results.forEach(function(item) {
            var name = item.document || item.title;
            if (!byName[name]) {
                byName[name] = { name: name, order: item.order, items: [] };
                groups.push(byName[name]);
            }
            byName[name].items.push(item);
        });
        // Sidebar order, so the results read in the same sequence as the site.
        return groups.sort(function(a, b) { return a.order - b.order; });
    }

    function resultHref(url, query) {
        var hashIndex = url.indexOf('#');
        var path = hashIndex === -1 ? url : url.slice(0, hashIndex);
        var hash = hashIndex === -1 ? '' : url.slice(hashIndex);
        return path + '?h=' + encodeURIComponent(query) + hash;
    }

    function renderRow(item, query) {
        var href = resultHref(item.url, query);
        var $link = $('<a>', { href: href, 'class': 'cc-result__link', 'data-is-search': '1' });
        if ($link[0].pathname === location.pathname) {
            $link.attr('data-need-reload', '1');
        }

        var $head = $('<span class="cc-result__head"></span>');
        if (item.reference) {
            $head.append($('<span>', { 'class': 'cc-result__ref', text: item.reference }));
        }
        // Westminster rows carry no label because the badge already names the
        // section; fall back to the document name so a row is never headless.
        var heading = item.label || (item.reference ? '' : item.document);
        if (heading) {
            $head.append($('<span>', { 'class': 'cc-result__label', text: heading }));
        }
        if (item.proofMatch) {
            $head.append($('<span>', { 'class': 'cc-result__proof', text: 'proof' }));
        }

        return $('<li>', { 'class': 'cc-result' }).append(
            $link
                .append($head)
                .append($('<span>', { 'class': 'cc-result__snippet' }).html(item.snippet))
        );
    }

    function renderChips(counts, total) {
        var $chips = $('.cc-chips').empty();
        if (counts.length < 2) return;          // one document: nothing to filter
        var all = $('<button>', {
            type: 'button',
            'class': 'cc-chip',
            'data-document': '',
            'aria-pressed': activeDocument ? 'false' : 'true'
        }).append($('<span>', { 'class': 'cc-chip__name', text: 'All documents' }))
          .append($('<span>', { 'class': 'cc-chip__count', text: total }));
        $chips.append(all);

        counts.forEach(function(entry) {
            $('<button>', {
                type: 'button',
                'class': 'cc-chip',
                'data-document': entry.name,
                'aria-pressed': activeDocument === entry.name ? 'true' : 'false'
            }).append($('<span>', { 'class': 'cc-chip__name', text: entry.name }))
              .append($('<span>', { 'class': 'cc-chip__count', text: entry.count }))
              .appendTo($chips);
        });
    }

    function displayResults(query, results, documentCounts) {
        var $container = $('#book-search-results');
        var $results = $container.find('.cc-search');
        var $list = $results.find('.cc-results');
        var noResults = results.length === 0;

        $('body').addClass('with-search').removeClass('search-loading');
        $results.attr('aria-busy', 'false');
        $container.addClass('open').toggleClass('no-results', noResults);
        $results.find('.search-results-count').text(results.length);
        $results.find('.search-query').text(query);
        $list.empty();

        var total = documentCounts.reduce(function(sum, entry) {
            return sum + entry.count;
        }, 0);
        renderChips(documentCounts, total);

        groupByDocument(results).forEach(function(group) {
            var $items = $('<ol class="cc-group__items"></ol>');
            group.items.forEach(function(item) {
                $items.append(renderRow(item, query));
            });
            $('<li>', { 'class': 'cc-group' })
                .append($('<h2>', { 'class': 'cc-group__title' })
                    .append($('<span>', { 'class': 'cc-group__name', text: group.name }))
                    .append($('<span>', { 'class': 'cc-group__count', text: group.items.length })))
                .append($items)
                .appendTo($list);
        });

        var bodyInner = document.querySelector('.body-inner');
        if (bodyInner) bodyInner.scrollTop = 0;
    }

    function closeSearch() {
        $('body').removeClass('with-search search-loading');
        $('#book-search-results').removeClass('open no-results');
    }

    function syncInputs(value, source) {
        $(INPUTS).each(function() {
            if (this !== source) $(this).val(value);
        });
    }

    function search(value, source) {
        syncInputs(value, source);
        if (String(value || '').trim().length < MIN_QUERY) {
            closeSearch();
            return;
        }
        $('body').addClass('search-loading');
        $('.cc-search').attr('aria-busy', 'true');
        loadIndex().then(function() { runQuery(value); });
    }

    function searchUrl(query) {
        return state.basePath + '/search/?q=' + encodeURIComponent(query);
    }

    function bindEvents() {
        var timer;
        $('body').off('.creedsSearch');
        $('body').on('input.creedsSearch', INPUTS, function() {
            var input = this;
            // On reading pages every search box is just a launcher: typing keeps
            // the boxes in sync but does not search inline, because inline
            // results replace the whole page on the first keystroke. Enter (the
            // keydown handler below) sends the query to /search/. Live results
            // are only for the dedicated search page.
            if (!isSearchPage()) {
                syncInputs(input.value, input);
                return;
            }
            clearTimeout(timer);
            timer = setTimeout(function() {
                search(input.value, input);
                if (history.replaceState) {
                    history.replaceState({}, '', searchUrl(input.value));
                }
            }, 200);
        });
        $('body').on('keydown.creedsSearch', INPUTS, function(event) {
            if (event.key === 'Escape') {
                this.value = '';
                syncInputs('', this);
                closeSearch();
                return;
            }
            // Arrow down from the field walks into the results.
            if (event.key === 'ArrowDown' && isSearchPage()) {
                var first = resultLinks()[0];
                if (first) {
                    event.preventDefault();
                    first.focus();
                }
                return;
            }
            if (event.key !== 'Enter') return;
            var query = this.value.trim();
            if (!query) return;
            if (!isSearchPage()) {
                event.preventDefault();
                location.href = searchUrl(query);
            }
        });
        $('body').on('change.creedsSearch', '#search-collection-filter', function() {
            // A collection change can orphan the selected document, so reset it.
            activeDocument = '';
            runQuery(currentQuery);
        });
        $('body').on('click.creedsSearch', '.cc-chip', function() {
            var name = this.getAttribute('data-document') || '';
            activeDocument = activeDocument === name ? '' : name;
            runQuery(currentQuery);
        });
        // Arrow keys move between results; Enter and Tab keep their native
        // behaviour, so the list stays reachable without a mouse either way.
        $('body').on('keydown.creedsSearch', '.cc-result__link', function(event) {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            var links = resultLinks();
            var index = links.indexOf(this);
            if (index === -1) return;
            event.preventDefault();
            var next = index + (event.key === 'ArrowDown' ? 1 : -1);
            if (next < 0) {
                var input = document.querySelector('#search-page-input');
                if (input) input.focus();
                return;
            }
            if (links[next]) links[next].focus();
        });
        $('body').on('click.creedsSearch', 'a[data-need-reload]', function() {
            setTimeout(function() { location.reload(); }, 100);
        });
    }

    function resultLinks() {
        return Array.prototype.slice.call(
            document.querySelectorAll('.cc-result__link')
        );
    }

    function highlightPage(query) {
        if (!query) return;
        $('.page-inner').unmark({
            done: function() {
                $('.page-inner').mark(query, {
                    ignoreJoiners: true,
                    acrossElements: true,
                    separateWordSearch: false,
                    done: function() {
                        setTimeout(function() {
                            var target = location.hash ?
                                document.getElementById(decodeURIComponent(location.hash.slice(1))) :
                                document.querySelector('mark[data-markjs="true"]');
                            if (target) target.scrollIntoView();
                        }, 100);
                    }
                });
            }
        });
    }

    function parameter(name) {
        return new URLSearchParams(location.search).get(name) || '';
    }

    function restoreFromUrl() {
        var query = parameter('q');
        var highlight = parameter('h');
        if (query) {
            $(INPUTS).val(query);
            search(query);
        } else {
            closeSearch();
        }
        if (highlight) highlightPage(highlight);
    }

    gitbook.events.on('start', function() {
        bindEvents();
        loadIndex();
        restoreFromUrl();
    });
    gitbook.events.on('page.change', restoreFromUrl);
});
