require([
    'gitbook',
    'jquery'
], function(gitbook, $) {
    var MAX_DESCRIPTION_SIZE = 500;
    var state = gitbook.state;
    var INDEX_DATA = {};
    var usePushState = (typeof history.pushState !== 'undefined');

    // DOM Elements
    var $body = $('body');
    var $bookSearchResults;
    var $searchList;
    var $searchTitle;
    var $searchResultsCount;
    var $searchQuery;

    // Throttle search
    function throttle(fn, wait) {
        var timeout;

        return function() {
            var ctx = this,
                args = arguments;
            if (!timeout) {
                timeout = setTimeout(function() {
                    timeout = null;
                    fn.apply(ctx, args);
                }, wait);
            }
        };
    }

    function displayResults(res) {
        $bookSearchResults = $('#book-search-results');
        $searchList = $bookSearchResults.find('.search-results-list');
        $searchTitle = $bookSearchResults.find('.search-results-title');
        $searchResultsCount = $searchTitle.find('.search-results-count');
        $searchQuery = $searchTitle.find('.search-query');

        $bookSearchResults.addClass('open');

        var noResults = res.count == 0;
        $bookSearchResults.toggleClass('no-results', noResults);

        // Clear old results
        $searchList.empty();

        // Display title for research
        $searchResultsCount.text(res.count);
        $searchQuery.text(res.query);

        // Create an <li> element for each result
        res.results.forEach(function(item) {
            var $li = $('<li>', {
                'class': 'search-results-item'
            });

            var $title = $('<h3>');

            // Build the href so the ?h= highlight query sits BEFORE any
            // #section-anchor (index entries are now per-section and their
            // url may include a fragment, e.g. /pages/wcf/#wcf-1-1).
            var hParam = '?h=' + encodeURIComponent(res.query);
            var hashPos = item.url.indexOf('#');
            var href = hashPos === -1
                ? item.url + hParam
                : item.url.slice(0, hashPos) + hParam + item.url.slice(hashPos);

            var $link = $('<a>', {
                'href': href,
                'text': item.title,
                'data-is-search': 1
            });

            // Reload when the target is the page we're already on (so the
            // highlight re-runs), comparing paths only — ignore query/hash.
            if ($link[0].pathname === location.pathname) {
                $link[0].setAttribute('data-need-reload', 1);
            }

            // item.body is already a trimmed, ellipsis-bounded snippet with the
            // keyword wrapped in a highlight span (built in query()).
            var $content = $('<p>').html(item.body);

            $link.appendTo($title);
            $title.appendTo($li);
            $content.appendTo($li);
            $li.appendTo($searchList);
        });
        $('.body-inner').scrollTop(0);
    }

    function escapeReg(keyword) {
        //escape regexp prevserve word
        return String(keyword).replace(/([\*\.\?\+\$\^\[\]\(\)\{\}\|\/\\])/g, '\\$1');
    }

    function query(keyword) {
        if (keyword == null || keyword.trim() === '') return;

        var results = [],
            index = -1;
        for (var page in INDEX_DATA) {
            if ((index = INDEX_DATA[page].body.toLowerCase().indexOf(keyword.toLowerCase())) !== -1) {
                var fullBody = INDEX_DATA[page].body;
                var start = Math.max(0, index - 50);
                var end = Math.min(fullBody.length, start + MAX_DESCRIPTION_SIZE);
                var snippet = fullBody.substring(start, end);
                // Trim a partial word at the start and prefix an ellipsis.
                if (start > 0) {
                    var firstSpace = snippet.indexOf(' ');
                    if (firstSpace > -1 && firstSpace < 30) {
                        snippet = snippet.slice(firstSpace + 1);
                    }
                    snippet = '…' + snippet;
                }
                // Trim a partial word at the end and append an ellipsis.
                if (end < fullBody.length) {
                    var lastSpace = snippet.lastIndexOf(' ');
                    if (lastSpace > snippet.length - 30) {
                        snippet = snippet.slice(0, lastSpace);
                    }
                    snippet = snippet + '…';
                }
                results.push({
                    url: page,
                    title: INDEX_DATA[page].title,
                    body: snippet.replace(new RegExp('(' + escapeReg(keyword) + ')', 'gi'), '<span class="search-highlight-keyword">$1</span>')
                });
            }
        }
        displayResults({
            count: results.length,
            query: keyword,
            results: results
        });
    }

    function launchSearch(keyword) {
        // Add class for loading
        $body.addClass('with-search');
        $body.addClass('search-loading');

        function doSearch() {
            query(keyword);
            $body.removeClass('search-loading');
        }

        throttle(doSearch)();
    }

    function closeSearch() {
        $body.removeClass('with-search');
        $('#book-search-results').removeClass('open');
    }

    function bindSearch(target) {
        // Asynchronously load the index data
        {
            var url = state.basePath + "/assets/search_plus_index.json";
            $.getJSON(url).then(function(data) {
                INDEX_DATA = data;
                handleUpdate();
            }).fail(function() {
                if (window.console) {
                    console.error('Search index failed to load: ' + url);
                }
            });
        }

        // Bind DOM
        var $body = $('body');

        // Launch query based on input content
        function handleUpdate() {
            var $searchInput = $(target);
            var keyword = $searchInput.val();

            if (keyword === undefined || keyword.length == 0) {
                closeSearch();
            } else {
                launchSearch(keyword);
            }
        }

        $body.on('keyup', target, function(e) {
            if (e.keyCode === 13) {
                if (usePushState) {
                    var uri = updateQueryString('q', $(this).val());
                    history.pushState({
                        path: uri
                    }, null, uri);
                }
            }
            handleUpdate();
        });

        $body.on('click', target, function(e) {
            if (Object.keys(INDEX_DATA).length === 0) {
                var url = state.basePath + "/assets/search_plus_index.json";
                $.getJSON(url).then(function(data) {
                    INDEX_DATA = data;
                    handleUpdate();
                }).fail(function() {
                    if (window.console) {
                        console.error('Search index failed to load: ' + url);
                    }
                });
            }
        });

        // Push to history on blur
        $body.on('blur', target, function(e) {
            // Update history state
            if (usePushState) {
                var uri = updateQueryString('q', $(this).val());
                history.pushState({
                    path: uri
                }, null, uri);
            }
        });
    }

    gitbook.events.on('start', function() {
        bindSearch('#book-search-input input');
        bindSearch('#book-search-input-inside input');

        showResult();
        closeSearch();
    });

    // 高亮文本
    var highLightPageInner = function(keyword) {
        $('.page-inner').mark(keyword, {
            'ignoreJoiners': true,
            'acrossElements': true,
            'separateWordSearch': false
        });

        setTimeout(function() {
            // Prefer the section anchor from the deep link, so the user lands
            // on the exact matched section; fall back to the first highlight.
            if (location.hash && location.hash.length > 1) {
                var target = document.getElementById(
                    decodeURIComponent(location.hash.slice(1)));
                if (target) {
                    target.scrollIntoView();
                    return;
                }
            }
            var mark = $('mark[data-markjs="true"]');
            if (mark.length) {
                mark[0].scrollIntoView();
            }
        }, 100);
    };

    function showResult() {
        var keyword, type;
        if (/\b(q|h)=([^&]+)/.test(location.search)) {
            type = RegExp.$1;
            keyword = decodeURIComponent(RegExp.$2);
            if (type === 'q') {
                launchSearch(keyword);
            } else {
                highLightPageInner(keyword);
            }
            $('#book-search-input input').val(keyword);
            $('#book-search-input-inside input').val(keyword);
        }
    }

    gitbook.events.on('page.change', showResult);

    function getParameterByName(name) {
        var url = window.location.href;
        name = name.replace(/[\[\]]/g, '\\$&');
        var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)', 'i'),
            results = regex.exec(url);
        if (!results) return null;
        if (!results[2]) return '';
        return decodeURIComponent(results[2].replace(/\+/g, ' '));
    }

    function updateQueryString(key, value) {
        value = encodeURIComponent(value);

        var url = window.location.href.replace(/([?&])(?:q|h)=([^&]+)(&|$)/, function(all, pre, value, end) {
            if (end === '&') {
                return pre;
            }
            return '';
        });
        var re = new RegExp('([?&])' + key + '=.*?(&|#|$)(.*)', 'gi'),
            hash;

        if (re.test(url)) {
            if (typeof value !== 'undefined' && value !== null)
                return url.replace(re, '$1' + key + '=' + value + '$2$3');
            else {
                hash = url.split('#');
                url = hash[0].replace(re, '$1$3').replace(/(&|\?)$/, '');
                if (typeof hash[1] !== 'undefined' && hash[1] !== null)
                    url += '#' + hash[1];
                return url;
            }
        } else {
            if (typeof value !== 'undefined' && value !== null) {
                var separator = url.indexOf('?') !== -1 ? '&' : '?';
                hash = url.split('#');
                url = hash[0] + separator + key + '=' + value;
                if (typeof hash[1] !== 'undefined' && hash[1] !== null)
                    url += '#' + hash[1];
                return url;
            } else
                return url;
        }
    }
    window.addEventListener('click', function(e) {
        if (e.target.tagName === 'A' && e.target.getAttribute('data-need-reload')) {
            setTimeout(function() {
                location.reload();
            }, 100);
        }
    }, true);
});