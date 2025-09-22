// Background script for Image Enlarger extension
// This runs as a service worker in Manifest V3

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    console.log('Image Enlarger extension installed');
  } else if (details.reason === 'update') {
    console.log('Image Enlarger extension updated');
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Image Enlarger extension started');
});

// Optional: Add context menu or browser action functionality in the future
// This background script is minimal for now but provides a foundation for future features
