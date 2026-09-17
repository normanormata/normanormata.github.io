---
layout: home
title: Creeds & Confessions of the Church
description: Searchable creeds, confessions, and catechisms of the church — the ecumenical creeds, the Westminster Standards, the Three Forms of Unity, and the OPC Book of Church Order.
permalink: /
---

Searchable creeds, confessions, and catechisms of the church.

<form class="home-search" action="{{ site.baseurl }}/search/" method="get" role="search">
  <label for="home-search-input">Search every creed, confession, catechism, and scripture proof</label>
  <div class="home-search__field">
    <i class="fa fa-search" aria-hidden="true"></i>
    <input id="home-search-input" name="q" type="search"
           placeholder="Try “justification” or “WCF 3.1”"
           autocomplete="off">
    <button type="submit">Search</button>
  </div>
</form>

## The Ecumenical Creeds

{% include document-grid.html category="ecumenical-creeds" %}

## The Westminster Standards

{% include document-grid.html category="westminster-standards" %}

Each of these carries the OPC lettered scripture proofs in collapsible callouts, and can
be read either in the constitutional text or in the 2025 Modern English Study Version —
use the <i class="fa fa-language" aria-hidden="true"></i> toggle in the toolbar. The MESV
is for study only and carries no constitutional authority.

## The Three Forms of Unity

{% include document-grid.html category="three-forms-of-unity" %}

## The OPC Book of Church Order

{% include document-grid.html category="book-of-church-order" %}

## Scripture Index

The confessions cite scripture; the [scripture index]({{ site.baseurl }}/scripture/) reads
the other way. Look up a book of the Bible and see every section of the Westminster
Standards and the Heidelberg Catechism that cites it.

## Downloads and tools

The Westminster Standards as PDFs: two-column comparisons of the constitutional text against
the 2025 MESV, and the OPC print layouts.

<table class="downloads">
  <thead>
    <tr>
      <th scope="col">Document</th>
      <th scope="col">Compared with the 2025 MESV</th>
      <th scope="col">OPC print layout</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Confession of Faith</th>
      <td><a href="{{ site.baseurl }}/assets/Two_column_comparison_of_the_constitutional_text_of_The_Confession_of_Faith_and_2025_MESV.pdf" aria-label="Confession of Faith: comparison with the 2025 MESV (PDF)">PDF</a></td>
      <td><a href="{{ site.baseurl }}/assets/CFLayout.pdf" aria-label="Confession of Faith: OPC print layout (PDF)">PDF</a></td>
    </tr>
    <tr>
      <th scope="row">Shorter Catechism</th>
      <td><a href="{{ site.baseurl }}/assets/Two_column_comparison_of_the_constitutional_text_of_The_Shorter_Catechism_and_2025_MESV.pdf" aria-label="Shorter Catechism: comparison with the 2025 MESV (PDF)">PDF</a></td>
      <td><a href="{{ site.baseurl }}/assets/SCLayout.pdf" aria-label="Shorter Catechism: OPC print layout (PDF)">PDF</a></td>
    </tr>
    <tr>
      <th scope="row">Larger Catechism</th>
      <td><a href="{{ site.baseurl }}/assets/Two_column_comparison_of_the_constitutional_text_of_The_Larger_Catechism_and_2025_MESV.pdf" aria-label="Larger Catechism: comparison with the 2025 MESV (PDF)">PDF</a></td>
      <td><a href="{{ site.baseurl }}/assets/LCLayout.pdf" aria-label="Larger Catechism: OPC print layout (PDF)">PDF</a></td>
    </tr>
  </tbody>
</table>

For the terminal, the [Westminster Standards CLI](https://github.com/normanormata/westminster_cli)
reads, searches, and quizzes you on the same OPC constitutional text and 2025 MESV that this
site carries. Install it with
[`uv tool install westminster-standards-cli`](https://pypi.org/project/westminster-standards-cli/),
then run `ws wcf 1` or `ws wsc 1 --question`.
