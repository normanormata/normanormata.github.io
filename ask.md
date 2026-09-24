---
layout: ask-base
title: Ask a question
description: Ask a question in plain words and get an answer drawn from the creeds, confessions, and catechisms on Creeds & Confessions, with every citation linked to its section.
permalink: /ask/
exclude_from_search: true
sitemap: false
---

{%- comment -%}
  The Ask interface itself is _includes/ask-ui.html, shared with the side panel
  (_includes/ask-panel.html). With no site.assistant_url it says the assistant
  isn't available and points to search instead.
{%- endcomment -%}
{% include ask-ui.html input_id="ask-input" %}
