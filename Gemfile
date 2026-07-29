# frozen_string_literal: true

source "https://rubygems.org"

git_source(:github) { |repo_name| "https://github.com/#{repo_name}" }

# The site is deployed by GitHub Pages' built-in Jekyll build, which ignores this
# Gemfile and uses its own pinned dependency set. Tracking the `github-pages` gem
# is what keeps local and CI builds honest about what production actually runs —
# a bare `gem "jekyll"` silently drifts to a newer Jekyll than Pages supports, so
# "it built locally" stops meaning anything.
#
# Requires Ruby >= 2.7. Commit Gemfile.lock, and upgrade with
# `bundle update github-pages` rather than bumping Jekyll directly.
gem "github-pages", group: :jekyll_plugins

# All of these are on the GitHub Pages plugin allow-list, so the built-in Pages
# build honours them. They are declared explicitly for local and CI builds.
group :jekyll_plugins do
  gem "jekyll-feed"
  gem "jekyll-remote-theme"
  gem "jekyll-seo-tag"
  gem "jekyll-sitemap"
  gem "jemoji"
end

gem "webrick"
