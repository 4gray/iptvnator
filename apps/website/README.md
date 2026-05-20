# IPTVnator Website

The website is an Astro static site deployed to GitHub Pages at `https://4gray.github.io/iptvnator/`.

## Blog Comments

Blog posts render Giscus comments from `apps/website/src/components/GiscusComments.astro`.
Giscus stores comments in GitHub Discussions for `4gray/iptvnator` and maps each page to a discussion by `pathname`, including the GitHub Pages base path such as `/iptvnator/blog/why-external-players-help/`.

The embed is wired to the dedicated `Blog comments` discussion category:

- Repository id: `MDEwOlJlcG9zaXRvcnkyMTMxOTQ3Mzg=`
- Category id: `DIC_kwDODLUX8s4C9eBJ`
- Mapping: `pathname`
- Theme: `transparent_dark`

If the category is recreated, query the new category id:

```bash
gh api graphql \
  -f owner=4gray \
  -f name=iptvnator \
  -f query='query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { discussionCategories(first:25) { nodes { id name slug isAnswerable } } } }'
```

Then update `data-category-id` in `GiscusComments.astro`.

Moderation happens in GitHub Discussions. Maintainers can hide, delete, lock, or move discussions and comments from the repository Discussions UI.
