# Suno → After Effects Lyric Slides

Transform Suno AI song lyrics into professional After Effects animations and standard subtitle files with one click! 🎵✨

## 🎯 What This Does

This Tampermonkey userscript automatically extracts perfectly-timed lyrics from Suno.com and generates:

- **📽️ After Effects JSX Script** - Animated karaoke-style lyric slides with professional typography
- **📝 SRT Subtitle File** - Standard subtitles for YouTube, Premiere, DaVinci, and more
- **🔧 Raw JSON Data** - Complete API response for debugging/custom use

## 🚀 Installation & Setup

### Step 1: Install Tampermonkey
1. Install the Tampermonkey browser extension:
   - **Chrome**: [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - **Firefox**: [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - **Safari**: [App Store](https://apps.apple.com/us/app/tampermonkey/id1482490089)
   - **Edge**: [Microsoft Store](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### Step 2: Install the Script
1. Open Tampermonkey dashboard (click the extension icon → Dashboard)
2. Click **"Create a new script"**
3. Replace the default code with the contents of `script.js`
4. Press **Ctrl+S** (or Cmd+S on Mac) to save
5. The script will automatically activate on Suno.com

## 🎮 How to Use

### On Suno.com:
1. Navigate to any song page (e.g., `https://suno.com/song/your-song-id`)
2. Look for the purple **"AE: Build Lyric Slides"** button that appears over song artwork
3. Click the button and wait for processing:
   - "Fetching lyrics…" 
   - "Preparing slides…"
   - "Rendering JSX…"
   - "✓ Files Ready (JSX + SRT + JSON)"
4. Three files will automatically download to your default download folder

## 📁 Generated Files

### `songId_lyric_slides_boxtext.jsx`
**After Effects script** that creates:
- Professional nested composition structure
- 2-4 line lyric slides with perfect timing
- Roboto-Bold typography with soft shadows
- Word-by-word highlighting animations
- Clean, YouTube-production-quality styling
- No background plates for modern aesthetic

### `songId_subtitles.srt`
**Standard subtitle file** compatible with:
- YouTube (direct upload for captions)
- Adobe Premiere Pro
- DaVinci Resolve
- Final Cut Pro
- Any video editor or media player
- Streaming platforms

### `songId_raw_data.json`
**Complete API response** containing:
- Original timing data
- Word-level synchronization
- Metadata for debugging

## 🎬 Using in After Effects

### Import the JSX Script:
1. Open After Effects
2. Go to **File → Scripts → Run Script File...**
3. Select the downloaded `.jsx` file
4. Click **Open**

### What Gets Created:
```
Project Panel:
├── Suno_[songId]/
│   ├── Comps/
│   │   ├── Main_[songId]           ← Your final output
│   │   └── [songId]_Lyrics_Master  ← All lyrics combined
│   ├── Slides/
│   │   ├── Slide_01 (3 lines)
│   │   ├── Slide_02 (4 lines)
│   │   └── ...
│   └── Assets/
```

### The Main Composition:
- **1920×1080** full HD resolution
- **60fps** for smooth playback
- **LYRICS_MASTER** layer positioned at first lyric timing
- Ready to composite with your music and visuals

### Lyric Slides Features:
- **Smart Grouping**: 2-4 lines per slide for optimal readability
- **Precise Timing**: Synced to original Suno timing data
- **Fade Animations**: Smooth in/out transitions
- **Word Highlighting**: Individual words light up as they're sung
- **Professional Typography**: Roboto-Bold with subtle drop shadows
- **Clean Layout**: Centered, readable, production-ready

## 🎨 Styling Details

### Typography:
- **Font**: Roboto-Bold (clean, YouTube-standard)
- **Colors**: 
  - Base text: Light gray (85% white)
  - Highlighted: Pure white (100%)
- **Effects**: Soft drop shadow (40% opacity, feathered)
- **No stroke**: Clean, modern appearance

### Layout:
- **Full-frame compositions** (1920×1080)
- **Vertically centered** at Y=540
- **Safe area margins** for broadcast compatibility
- **Organized folder structure** for easy navigation

## 🔧 Customization

Want to modify the styling? Edit these config values in the script:

```javascript
// Font and colors
const FONT_FAMILY = "Roboto-Bold";
const COLOR_BASE = [0.85, 0.85, 0.85];  // Base text color
const COLOR_HI   = [1.00, 1.00, 1.00];  // Highlight color

// Shadow settings
const SHADOW_OPACITY = 40;    // Shadow transparency
const SHADOW_DISTANCE = 6;    // How far shadow extends
const SHADOW_SOFTNESS = 12;   // Shadow blur amount

// Background plate (currently disabled)
const USE_BG = false;         // Set to true to enable background
```

## 🎵 Perfect for:

- **Music videos** with synced lyrics
- **Karaoke content** for YouTube/TikTok
- **Lyric videos** for artists and creators
- **Educational content** with timed text
- **Podcast highlights** with captions
- **Social media content** with engaging text animations

## 🔍 Troubleshooting

### Button Not Appearing?
- Make sure you're on a song page (`/song/song-id`)
- Refresh the page
- Check that Tampermonkey is enabled

### JSX Script Errors?
- Ensure you have the required fonts installed (Roboto)
- Check After Effects version compatibility
- Try running on a fresh project

### Timing Issues?
- The script uses Suno's original timing data
- No manual adjustment needed - timing is frame-accurate
- Check the raw JSON file if you need to debug timing

### Font Not Found?
- Install **Roboto** font on your system
- Alternative: Change `FONT_FAMILY` in script to any installed font
- Common alternatives: "Arial-BoldMT", "Helvetica-Bold"

## 🎉 Pro Tips

1. **Layer Organization**: The script creates organized folders - use them!
2. **Timing Precision**: Don't modify the timing - it's already perfectly synced
3. **Color Grading**: The neutral colors work well with any background
4. **Export Settings**: Use 60fps for smoothest playback
5. **YouTube Upload**: Use the SRT file for automatic captions

## 🤝 Contributing

Found a bug or want to improve the script? Feel free to submit issues or pull requests!

## 📄 License

Free to use and modify. Credit appreciated but not required.

---

**Made with ❤️ for the Suno community**

*Transform your AI-generated music into professional video content!*