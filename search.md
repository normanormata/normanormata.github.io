---
layout: search-base
title: Search
description: Search every creed, confession, catechism, scripture proof, and church-order document on Creeds & Confessions.
permalink: /search/
exclude_from_search: true
---

<div class="search-page-intro">
  <form class="search-page-form" action="{{ site.baseurl }}/search/" method="get" role="search">
    <label class="visually-hidden" for="search-page-input">Search this site</label>
    <div class="home-search__field">
      <i class="fa fa-search" aria-hidden="true"></i>
      <input id="search-page-input" name="q" type="search"
             placeholder="Search a word, phrase, or reference"
             autocomplete="off" autofocus>
      <button type="submit">Search</button>
    </div>
  </form>
  {%- comment -%}
    No trailing punctuation after the last <code>: the chip has a background, so a
    stray period wrapping onto its own line reads as a typo.
  {%- endcomment -%}
  <p class="search-page-hint">
    Searches the constitutional text and the scripture proofs — or jump straight to
    a reference like <code>WCF 3.1</code>, <code>WSC 1</code>, <code>Heidelberg 21</code>
  </p>
</div>
