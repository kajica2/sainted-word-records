---
title: Use Claude 4.7 High-Resolution Image Capabilities Correctly
impact: MEDIUM
impactDescription: Ensures image prompts use accurate coordinates and stay within the 2576px cap
tags: claude-4-7, images, vision, coordinates, bounding-box
---

## Use Claude 4.7 High-Resolution Image Capabilities Correctly

Claude 4.7 raises the maximum image dimension to 2576px (up from 1568px in
4.6) and costs 4784 tokens per image regardless of content complexity. Images
are also processed with 1:1 bounding-box pixel coordinates -- coordinates
returned by the model map directly to pixels in the original image. Prompts
that assumed scaled or normalized coordinates from earlier models must be
updated.

**Incorrect (assumes normalized coordinates from earlier models):**

```text
The bounding box for the submit button is at (0.45, 0.72).
Click at relative position (0.45, 0.72) on the image.
```

**Correct (1:1 pixel coordinates for Claude 4.7):**

```text
The bounding box for the submit button is at pixel (1156, 1854)
in the 2576x2576 image. Use those absolute pixel coordinates
when referencing the location.
```

**Key specifications for Claude 4.7 vision:**

| Property | Value |
|----------|-------|
| Maximum dimension | 2576px (either side) |
| Token cost per image | 4784 tokens (flat, content-independent) |
| Coordinate system | 1:1 bounding-box pixels (not normalized) |

**Guidance for prompt authors:**

- Cap submitted images at 2576px on the longest side; larger images are
  down-scaled before processing, which shifts coordinates.
- When extracting bounding boxes in agent prompts, specify "return pixel
  coordinates in the original image space" to prevent ambiguity.
- Budget 4784 tokens per image when estimating context usage. A prompt
  with 4 images costs ~19 000 tokens before any text.
- Do not embed full-resolution screenshots in tight context budgets;
  crop to the region of interest first.

**Migration note from 4.6:** if a prior prompt relied on normalized (0.0-1.0)
or scaled coordinate output, add an explicit instruction: "Return bounding
box coordinates as absolute pixel values in the original image."

Reference: [Anthropic -- Claude 4.7 Vision](https://www.anthropic.com/news/claude-4)
