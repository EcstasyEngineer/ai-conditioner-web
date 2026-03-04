
# Architecture Document for Hypnosis Content Generation Application

## Introduction

This document outlines the architecture for a Python-based application designed to generate hypnosis content. The application serves as an engine that produces dynamic and personalized hypnosis sessions, incorporating various themes, text, images, audio, and user preferences. The application aims to deliver content through multiple front-end interfaces, including web, Discord, VRChat, and a local application.

## High-Level Concepts

### Themes

- **Definition**: High-level hypnosis motifs such as submission, mind emptying, or roleplay identities.
- **Purpose**: Serve as the foundational elements that guide the content generation process.
- **Implementation**: Stored in the database and associated with specific text snippets, images, and audio files.

### Sessions

- **Definition**: Configurations for individual hypnosis experiences.
- **Components**:
  - Selected themes.
  - User preferences (e.g., subject and dominant perspectives, genders).
  - Difficulty levels.
  - Duration and structure of the session.

## Front-End Components

### Web Application

- **Features**:
  - Displays randomized flashing words over randomized flashing images.
  - Supports both binaural beats and audio playback.
- **Technologies**:
  - HTML, CSS, JavaScript for the front-end.
  - WebSockets or AJAX for real-time content updates.
- **Integration**:
  - Retrieves content via API calls to the backend.

### Discord Integration

- **Features**:
  - Text-only sessions via direct messages to a bot.
  - Audio-only sessions in shared servers.
- **Technologies**:
  - Discord API and Python libraries (e.g., discord.py).
- **Limitations**:
  - Restricted to text and audio due to Discord's platform constraints.
- **Content Delivery**:
  - Directly accesses the database for content retrieval.

### VRChat Integration

- **Features**:
  - Custom VRChat world with pre-canned themes.
  - Dynamic content rendering based on API-sent session information.
- **Technologies**:
  - VRChat SDK and Unity for world development.
- **Integration**:
  - Uses API to receive text, images, and audio for dynamic rendering.

### Local Application

- **Features**:
  - Mirrors the web application's capabilities.
  - Outputs content directly to the screen or renders to an MP4 file.
- **Technologies**:
  - Python GUI frameworks (e.g., PyQt, Tkinter) or command-line interfaces.
- **Content Delivery**:
  - Accesses content directly from the database.

## Backend Components

### Database

- **Type**:
  - Initially SQLite, with support for PostgreSQL for scalability.
- **Purpose**:
  - Stores text snippets, templates, rendered audio files, images, and user profiles.
- **Schema Overview**:
  - **Lines Table**:
    - `template_text`: Original template of the line.
    - `real_text`: Rendered text based on user preferences.
    - `subject`, `sub_gender`, `sub_pov`: Information about the subject.
    - `dominant`, `dom_gender`, `dom_pov`: Information about the dominant.
    - `theme`, `difficulty`, `line_type`, `trigger`, `service`, `voice`.
    - `audio_file_path`, `audio_length`.
- **Considerations**:
  - Indexing for performance optimization.
  - Data normalization to reduce redundancy.

### API

- **Purpose**:
  - Facilitates communication between front-end interfaces (web and VRChat) and the backend.
- **Endpoints**:
  - `/getSession`: Retrieves session configuration and content.
  - `/getContent`: Provides images, text snippets, and audio links.
  - `/submitPreferences`: Allows users to submit or update their preferences.
- **Data Formats**:
  - JSON for structured data.
  - Image and audio data via URLs or base64 encoding (preferably URLs for efficiency).
- **Security**:
  - Authentication and authorization mechanisms.
  - Rate limiting and input validation.

## Session Rendering Logic

### Initial Implementation

- **Approach**:
  - Randomly iterate through text snippets (mostly single words) and images.
  - Play binaural beats in the background.
- **Content Selection**:
  - Random selection based on the chosen themes and difficulty levels.

### Advanced Implementation

- **Finite State Machine (FSM)**:
  - **States**: Induction, Deepener, Suggestion, Trigger, Awakening, etc.
  - **Transitions**: Defined by session progress, user responses, or predefined rules.
- **Goal States**:
  - Focus on specific aspects of a theme (e.g., the sensation of an empty mind).
  - Control the type of content displayed and the binaural beats used.
- **Difficulty Progression**:
  - Gradual increase in suggestion difficulty over time.
  - Gaussian distribution to prevent abrupt transitions.
- **Multi-Themed Sessions**:
  - Individual priming for each theme.
  - Difficulty levels adjusted per theme.
- **User Profiles**:
  - Store user-specific data for personalized sessions.
  - Adapt content based on previous sessions and feedback.

### Line Templates

- **Purpose**:
  - Reusable templates that generate lines in various perspectives.
- **Customization**:
  - Adjusts for subject and dominant perspectives, genders, and points of view.
- **Implementation**:
  - Templates with placeholders replaced during rendering based on session parameters.
- **Example Placeholders**:
  - `{subject}`, `{sub_pov}`, `{dominant}`, `{dom_pov}`, `{theme}`, `{difficulty}`.

## Missing Pieces of Information

1. **Database Schema Details**:
   - Need comprehensive schema diagrams.
   - Details on relationships between tables (e.g., themes, lines, sessions).

2. **API Specifications**:
   - Full list of API endpoints with request and response formats.
   - Error handling and status codes.
   - Authentication methods (e.g., OAuth2, API keys).

3. **User Profile Management**:
   - How user data is collected, stored, and used.
   - Privacy policies and compliance with data protection regulations (e.g., GDPR).

4. **Security Considerations**:
   - Measures against SQL injection, cross-site scripting (XSS), and other vulnerabilities.
   - Secure storage of sensitive data (e.g., encryption of personal information).

5. **Third-Party Integrations**:
   - Dependencies on external services (e.g., text-to-speech APIs, image repositories).
   - Licensing and usage restrictions for third-party content.

6. **Scalability and Performance**:
   - Strategies for handling increased load (e.g., caching, load balancing).
   - Database optimization techniques for faster queries.

7. **Content Moderation and Compliance**:
   - Guidelines to ensure content is appropriate and complies with legal standards.
   - Processes for reviewing and updating content.

8. **Testing and Quality Assurance**:
   - Automated testing frameworks.
   - User acceptance testing plans.

9. **Deployment Strategy**:
   - Environments setup (development, staging, production).
   - Continuous Integration/Continuous Deployment (CI/CD) pipelines.

10. **Logging and Monitoring**:
    - Systems for tracking application performance and errors.
    - Analytics for user engagement and session effectiveness.