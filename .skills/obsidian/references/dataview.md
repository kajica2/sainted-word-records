# Dataview Reference

## Inline queries

```dataview
LIST
FROM "Folder"
WHERE type = "note"
SORT created DESC
```

```dataview
TABLE created, tags, status
FROM ""
WHERE created >= 2025-01-01
SORT created DESC
```

```dataview
TASK
FROM "Projects"
WHERE !completed
```

## Field access

| Field | Access |
|---|---|
| Frontmatter string | `field` |
| Inline field | `field[inline]` |
| Date field | `date(field)` |
| Array field | `array(field)` |
| File metadata | `file.mtime`, `file.ctime`, `file.name`, `file.path` |

## Common patterns

```dataview
# Notes created today
LIST
FROM ""
WHERE date(created) = date(today)

# Notes by tag
TABLE title, created
FROM #project
SORT created DESC

# Notes without a tag
LIST
FROM ""
WHERE length(tags) = 0

# Tasks by status
TASK
WHERE status = "in_progress"

# Recently modified
TABLE file.mtime
FROM ""
SORT file.mtime DESC
LIMIT 10

# Notes with a date in a range
LIST
FROM ""
WHERE date >= 2025-01-01 AND date <= 2025-12-31
```

## Aggregations

```dataview
# Count notes by tag
LIST rows.file.link
GROUP BY some-field

# Flatten array field
FLATTEN tags as tag
GROUP BY tag
```
