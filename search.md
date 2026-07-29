---
layout: search-base
title: Search
description: Search every creed, confession, catechism, scripture proof, and church-order document on Creeds & Confessions.
permalink: /search/
exclude_from_search: true
---

<div class="search-page-intro">
  <p>Search the full collection or jump directly to a reference such as <strong>WCF 3.1</strong>, <strong>WSC 1</strong>, or <strong>Heidelberg 21</strong>.</p>
  <form class="search-page-form" action="{{ site.baseurl }}/search/" method="get" role="search">
    <label for="search-page-input">Search this site</label>
    <div class="home-search__field">
      <i class="fa fa-search" aria-hidden="true"></i>
      <input id="search-page-input" name="q" type="search"
             placeholder="Enter a word, phrase, or reference"
             autocomplete="off" autofocus>
      <button type="submit">Search</button>
    </div>
  </form>
</div>
