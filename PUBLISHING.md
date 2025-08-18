## Publishing

This project uses GitHub releases for publishing. To publish a new version:

1. **Create a GitHub Release**:
   - Go to the GitHub repository
   - Click "Releases" → "Create a new release"
   - Choose a tag (e.g., `v1.0.0`)
   - Add release notes
   - Publish the release

2. **Automated Publishing**:
   - The GitHub Actions workflow will automatically:
     - Build the project
     - Run tests
     - Update package.json version
     - Publish to NPM with provenance

**Note**: Manual npm publishing is disabled. All releases must go through GitHub releases to ensure proper versioning and automated testing.