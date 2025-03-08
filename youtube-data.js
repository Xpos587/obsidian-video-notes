module.exports = {
  settings: {
    name: "Youtube RAW Metadata",
    author: "Xpos587 <https://github.com/xpos587>",
  },
  entry: YoutubeRAW,
};

const { net } = require("electron").remote;

async function YoutubeRAW(ctx, settings) {
  // The folder where the notes will be saved
  const folder = await ctx.quickAddApi.inputPrompt(
    "Enter folder name",
    "Example: YouTube",
  );
  if (!folder) return null;

  // Get the URL from the user
  const url = await ctx.quickAddApi.inputPrompt(
    "Enter YouTube URL",
    "https://www.youtube.com/watch?v=NX-ZJ-d27Fc",
  );
  if (!url) return null;

  // Extract the video ID from the URL
  const videoId = extractVideoId(url);
  if (!videoId)
    throw new Error(
      "Could not extract video ID from URL. Please ensure this is a valid YouTube video URL.",
    );

  // Get the language of the subtitles from the user
  let lang = await ctx.quickAddApi.inputPrompt(
    "Enter language code for subtitles",
    "Example: en, en-US, ru",
  );
  if (!lang) lang = "en";

  try {
    const { metadata, subtitles } = await fetchVideoData(videoId, lang);

    ctx.variables = {
      ...ctx.variables,
      url: `https://youtu.be/${videoId}`,
      title: metadata.title,
      channel: metadata.author,
      folder: folder || "Videos",
      description: metadata.description,
      views: metadata.views,
      duration: formatDuration(metadata.lengthSeconds),
      published: metadata.publishDate,
      tags: metadata.keywords?.join(", ") || [],
      subtitles: formatSubtitles(subtitles, videoId),
    };

    await createFolderStructure(folder, metadata.author);
    console.log("TEST2");

    return null;
  } catch (e) {
    throw new Error(`Error: ${e.message}`);
  }
}

// Основные функции парсинга
async function fetchVideoData(videoId, lang) {
  const watchPage = await net.fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
  );
  const watchHtml = await watchPage.text();

  const initialData = extractInitialData(watchHtml);
  const metadata = extractMetadata(initialData);

  const subtitles = await fetchSubtitles(initialData, lang);
  return { metadata, subtitles };
}

function extractInitialData(html) {
  const regex = /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s;
  const match = html.match(regex);
  if (!match)
    throw new Error(
      "No video data found. Please ensure this is a valid YouTube video URL.",
    );
  return JSON.parse(match[1]);
}

function extractMetadata(data) {
  const details = data.videoDetails || {};
  const microformat = data.microformat?.playerMicroformatRenderer || {};

  return {
    title: details.title,
    author: details.author,
    description: details.shortDescription,
    views: parseInt(details.viewCount),
    lengthSeconds: parseInt(details.lengthSeconds),
    keywords: details.keywords,
    publishDate: microformat.publishDate,
  };
}

async function fetchSubtitles(data, lang) {
  const tracks =
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const subTrack = findBestSubtitle(tracks, lang);

  if (!subTrack) return [];
  const subResponse = await net.fetch(subTrack.baseUrl);
  return parseSubtitles(await subResponse.text());
}

function findBestSubtitle(tracks, lang) {
  const langCodes = [lang, `${lang}-US`, "en", "en-US"];
  for (const code of langCodes) {
    const track = tracks.find((t) => t.languageCode === code);
    if (track) return track;
  }
  return tracks[0];
}

function parseSubtitles(xml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    return Array.from(doc.querySelectorAll("text")).map((el) => ({
      start: parseFloat(el.getAttribute("start") || 0),
      text: (el.textContent || "").trim(),
    }));
  } catch (error) {
    return [];
  }
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return (
    [hours && `${hours}h`, minutes && `${minutes}m`]
      .filter(Boolean)
      .join(" ") || "0m"
  );
}

function formatSubtitles(subs, videoId) {
  return (subs || [])
    .map(
      (s) =>
        `[${formatTime(s.start)}](https://youtu.be/${videoId}?t=${Math.floor(s.start)}) ${s.text || ""}`,
    )
    .join("\n");
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

async function createFolderStructure(baseFolder, channel) {
  const sanitizedChannel = (channel || "Unknown Channel")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();

  const targetFolder = `${baseFolder}/${sanitizedChannel}`;

  try {
    if (!app.vault.getAbstractFileByPath(baseFolder)) {
      await app.vault.createFolder(baseFolder);
    }

    if (!app.vault.getAbstractFileByPath(targetFolder)) {
      await app.vault.createFolder(targetFolder);
    }
  } catch (error) {
    if (!error.message.includes("already exists")) {
      throw new Error(`Error then createFolderStructure: ${error.message}`);
    }
  }
}

function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}
