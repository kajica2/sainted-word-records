---
paths: "**/*.R,**/*.Rmd,**/DESCRIPTION,**/NAMESPACE"
---

# R Rules

Version: R 4.4+

## Tooling

- IDE: RStudio or VS Code
- Linting: lintr
- Formatting: styler
- Testing: testthat
- Package management: renv

## Foundational Standards

Canonical: tidyverse Style Guide — https://style.tidyverse.org/

- Use `snake_case` for variable names, function names, and file names.
- Limit lines to 80 columns (soft limit).
- Use 2-space indentation.
- Use `<-` for assignment; never use `=` for assignment at the top level.
- Place spaces around all infix operators (`+`, `-`, `<-`, `|>`, etc.).
- Do not use semicolons to separate statements.
- Use `TRUE`/`FALSE` for logical values; never use `T`/`F`.
- Prefer the native pipe `|>` (R 4.1+) over `%>%` for new code.
- Prefer tidyverse verbs (`dplyr`, `tidyr`) over base-R equivalents for data manipulation.
- Use `roxygen2` `#'` comments to document all exported functions.

## MUST

- Use tidyverse style for data manipulation
- Use ggplot2 for visualization
- Use roxygen2 for documentation
- Use renv for dependency management
- Vectorize operations over loops
- Handle NA values explicitly

## MUST NOT

- Use attach() for data frames
- Use setwd() in scripts
- Use T/F instead of TRUE/FALSE
- Leave hardcoded file paths
- Suppress warnings without reason
- Use <<- for global assignment

## File Conventions

- test-*.R for test files in tests/testthat/
- Use snake_case for functions and variables
- R/ for package source code
- Use .Rproj for project settings
- Keep scripts under 500 lines

## Testing

- Use testthat with expect_* assertions
- Use snapshot tests for complex output
- Use withr for temporary state changes
- Test edge cases and NA handling
