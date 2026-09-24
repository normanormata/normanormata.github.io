---
layout: ask-base
title: Ask a question
description: Ask a question in plain words and get an answer drawn from the creeds, confessions, and catechisms on Creeds & Confessions, with every citation linked to its section.
permalink: /ask/
exclude_from_search: true
sitemap: false
---

{%- comment -%}
  Everything below is driven by assets/gitbook/ask.js, which talks to the
  assistant Worker in assistant/ at site.assistant_url. With no assistant_url
  the page says the assistant isn't available and points to search instead.
{%- endcomment -%}
<div class="ask" data-state="idle">
  <p class="ask__intro">
    Ask in your own words. Answers are drawn only from the documents on this site, and every section they cite links to the text.
  </p>

  <div class="ask__notice">
    <p>
      <strong>Answers are written by AI and can be wrong.</strong>
      The documents themselves are the authority, so follow the links and read them.
      <span class="ask__data-notice"></span>
    </p>
  </div>

  <div class="ask__conversation"></div>

  <form class="ask__form" autocomplete="off">
    <label for="ask-input">Your question</label>
    <p class="ask__about" hidden>
      <span>About <span class="ask__about-label"></span></span>
      <button type="button" class="ask__about-clear">Ask about something else</button>
    </p>
    <div class="home-search__field">
      <i class="fa fa-comments" aria-hidden="true"></i>
      <input id="ask-input" name="question" type="text" maxlength="1000"
             placeholder="e.g. Can a Christian lose their salvation?">
      <button type="submit">Ask</button>
    </div>
  </form>

  <p class="ask__status" role="status" aria-live="polite"></p>

  <div class="ask__examples">
    <p class="ask__examples-title">Or try one of these:</p>
    <ul>
      <li><button type="button">What is the chief end of man?</button></li>
      <li><button type="button">What is our only comfort in life and death?</button></li>
      <li><button type="button">What do the Westminster Standards teach about the Sabbath?</button></li>
    </ul>
  </div>

  <p><button type="button" class="ask__reset" hidden>Start a new conversation</button></p>

  <p class="ask__unavailable" hidden>
    The assistant isn’t available right now. You can still
    <a href="{{ site.baseurl }}/search/">search the documents</a>.
  </p>
  <noscript>
    <p>The assistant needs JavaScript. You can still <a href="{{ site.baseurl }}/search/">search the documents</a>.</p>
  </noscript>
</div>
