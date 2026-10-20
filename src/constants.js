/**********************************************************************************************************************
 * This module contains constants that are meant to be used throughout the entire application.
 **********************************************************************************************************************/

// Strings
const APPLICATION_NAME = 'GVoicePlus';

// URLs
const URL_GOOGLE_VOICE           = 'https://voice.google.com'
const URL_GITHUB_README          = 'https://github.com/lazyb5/GVoicePlus/blob/master/README.md'
const URL_GITHUB_SECURITY_POLICY = 'https://github.com/lazyb5/GVoicePlus/blob/master/SECURITY.md'
const URL_GITHUB_VIEW_ISSUES     = 'https://github.com/lazyb5/GVoicePlus/issues';
const URL_GITHUB_REPORT_BUG      = 'https://github.com/lazyb5/GVoicePlus/issues/new?labels=bug';
const URL_GITHUB_FEATURE_REQUEST = 'https://github.com/lazyb5/GVoicePlus/issues/new?labels=enhancement';
const URL_GITHUB_ASK_QUESTION    = 'https://github.com/lazyb5/GVoicePlus/issues/new?labels=question';
const URL_GITHUB_RELEASES        = 'https://github.com/lazyb5/GVoicePlus/releases';

// "owner/name" of the GitHub repository whose latest release the "Check for updates" feature looks at (src/utils/updateCheck.js).
// Empty = update checking is switched off.  Set this to your own fork once it exists.
const UPDATE_CHECK_REPO = 'lazyb5/GVoicePlus';

// Default Settings
const DEFAULT_SETTING_SHOW_MENU_BAR   = true;
const DEFAULT_SETTING_THEME           = 'default';
const DEFAULT_SETTING_START_MINIMIZED = false;
const DEFAULT_SETTING_EXIT_ON_CLOSE   = false;
const DEFAULT_HIDE_DIALER_SIDEBAR     = false;

module.exports = {
    // Strings
    APPLICATION_NAME, // Application name (displayed in various places)

    // URLs
    URL_GOOGLE_VOICE,           // Google Voice homepage
    URL_GITHUB_README,          // The "README.md" file on GitHub
    URL_GITHUB_SECURITY_POLICY, // The "SECURITY.md" file on GitHub
    URL_GITHUB_VIEW_ISSUES,     // List of currently logged issues on GitHub
    URL_GITHUB_REPORT_BUG,      // Link to open a new bug on GitHub
    URL_GITHUB_FEATURE_REQUEST, // Link to request a feature on GitHub
    URL_GITHUB_ASK_QUESTION,    // Link to ask a question on GitHub
    URL_GITHUB_RELEASES,        // Link to published releases on GitHub
    UPDATE_CHECK_REPO,          // "owner/name" checked for new releases (empty = off)

    // Default Settings
    DEFAULT_SETTING_SHOW_MENU_BAR,   // Whether the MenuBar of the main application window should be visible
    DEFAULT_SETTING_THEME,           // Default theme to apply
    DEFAULT_SETTING_START_MINIMIZED, // Whether the application should start minimized to the system notification area
    DEFAULT_SETTING_EXIT_ON_CLOSE,   // Whether the application should terminate when the user closes the main application window
    DEFAULT_HIDE_DIALER_SIDEBAR      // Whether the dialer sidebar should be hidden or not
};