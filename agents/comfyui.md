# ComfyUI — Project Context

**Location:** `/Users/kaidejuricmasscmbook/Documents/ComfyUI`  
**MCP:** Configured in `opencode.json` as local npx server

---

## What It Is

ComfyUI — workflow-based generative AI (images, video, audio, 3D). Installed locally.

---

## For SWR Agents

When generating visual assets:

- **Workflows:** Read from ComfyUI's API format (Save → API Format)
- **Models:** Located in `ComfyUI/models/`
- **Custom nodes:** `ComfyUI/custom_nodes/`
- **Inputs/Outputs:** `ComfyUI/input/`, `ComfyUI/output/`

---

## Commands

```bash
# Activate venv
source ~/Documents/ComfyUI/.venv/bin/activate

# Start ComfyUI
cd ~/Documents/ComfyUI && python main.py
```

---

## Integration

MCP server: `npx -y comfyui-mcp` (configured in `opencode.json`)

Tools available via MCP:
- Generate images/videos/audio
- Search models
- Run workflows
- Manage nodes
