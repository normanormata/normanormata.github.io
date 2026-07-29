require(['gitbook', 'jquery'], function(gitbook, $) {
    'use strict';

    var state = gitbook.state;
    var INDEX_DATA = {};
    var indexRequest = null;
    var currentQuery = '';
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
                $('.search-results').attr('aria-busy', 'false');
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
        var documents = {};
        Object.keys(INDEX_DATA).forEach(function(key) {
            var item = INDEX_DATA[key];
            collections[item.collection || 'general'] = true;
            documents[item.document || item.title] = true;
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

        var $document = $('#search-document-filter');
        var selectedDocument = $document.val();
        $document.find('option').slice(1).remove();
        Object.keys(documents).sort().forEach(function(value) {
            $('<option>', { value: value, text: value }).appendTo($document);
        });
        $document.val(selectedDocument || '');
    }

    function makeSnippet(text, query, proofMatch) {
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
        safe = safe.replace(
            new RegExp('(' + escapeReg(escapeHtml(query)) + ')', 'gi'),
            '<mark class="search-highlight-keyword">$1</mark>'
        );
        if (proofMatch) {
            safe = '<span class="search-result-source">Scripture proof:</span> ' + safe;
        }
        return safe;
    }

    function runQuery(query) {
        query = String(query || '').trim();
        currentQuery = query;
        if (!query) {
            closeSearch();
            return;
        }

        var collection = $('#search-collection-filter').val() || '';
        var documentName = $('#search-document-filter').val() || '';
        var lowered = query.toLocaleLowerCase();
        var exactReference = /^(?:wcf\s+\d+\.\d+|wsc\s+\d+|wlc\s+\d+|heidelberg\s+\d+)$/i
            .test(query);
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
                snippet: makeSnippet(snippetSource, query, proofMatch),
                score: String(item.keywords || '').toLocaleLowerCase() === lowered ? 0 :
                    (String(item.keywords || '').toLocaleLowerCase().indexOf(lowered) !== -1 ? 1 :
                    (bodyIndex !== -1 ? 2 : 3))
            });
        });

        results.sort(function(a, b) {
            return a.score - b.score || a.title.localeCompare(b.title);
        });
        displayResults(query, results);
    }

    function resultHref(url, query) {
        var hashIndex = url.indexOf('#');
        var path = hashIndex === -1 ? url : url.slice(0, hashIndex);
        var hash = hashIndex === -1 ? '' : url.slice(hashIndex);
        return path + '?h=' + encodeURIComponent(query) + hash;
    }

    function displayResults(query, results) {
        var $container = $('#book-search-results');
        var $results = $container.find('.search-results');
        var $list = $results.find('.search-results-list');
        var noResults = results.length === 0;

        $('body').addClass('with-search').removeClass('search-loading');
        $results.attr('aria-busy', 'false');
        $container.addClass('open').toggleClass('no-results', noResults);
        $results.find('.search-results-count').text(results.length);
        $results.find('.search-query').text(query);
        $list.empty();

        results.forEach(function(item) {
            var href = resultHref(item.url, query);
            var $link = $('<a>', {
                href: href,
                text: item.title,
                'data-is-search': '1'
            });
            if ($link[0].pathname === location.pathname) {
                $link.attr('data-need-reload', '1');
            }
            $('<li>', { 'class': 'search-results-item' })
                .append($('<h3>').append($link))
                .append($('<p>', { 'class': 'search-result-meta' }).text(
                    labelCollection(item.collection) + ' · ' + item.document
                ))
                .append($('<p>').html(item.snippet))
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
        if (!String(value || '').trim()) {
            closeSearch();
            return;
        }
        $('body').addClass('search-loading');
        $('.search-results').attr('aria-busy', 'true');
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
            clearTimeout(timer);
            timer = setTimeout(function() {
                search(input.value, input);
                if (isSearchPage() && history.replaceState) {
                    history.replaceState({}, '', searchUrl(input.value));
                }
            }, 120);
        });
        $('body').on('keydown.creedsSearch', INPUTS, function(event) {
            if (event.key !== 'Enter') return;
            var query = this.value.trim();
            if (!query) return;
            if (!isSearchPage()) {
                event.preventDefault();
                location.href = searchUrl(query);
            }
        });
        $('body').on(
            'change.creedsSearch',
            '#search-collection-filter, #search-document-filter',
            function() { runQuery(currentQuery); }
        );
        $('body').on('click.creedsSearch', 'a[data-need-reload]', function() {
            setTimeout(function() { location.reload(); }, 100);
        });
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
