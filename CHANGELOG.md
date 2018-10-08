# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Changelog has links to GitHub comparisons

[Unreleased]: https://github.com/happycollision/angular-concurrency/compare/v1.1.0...HEAD

## [1.1.0] - 2018-10-02
### Added
- Feature: Enqueue schedule
### Changed
- Using a bad schedule name for a task will now throw instead of just fail to run at perform time.

[1.1.0]: https://github.com/happycollision/angular-concurrency/compare/v1.0.2...v1.1.0

## [1.0.2] - 2018-10-01
### Added
- tests
- Referecnce to [issue 1](https://github.com/happycollision/angular-concurrency/issues/1) in Readme
### Changed
- Documentation wording about dependencies
### Fixed
- discovered some bugs once I tested the implementation properly. All better.

[1.0.2]: https://github.com/happycollision/angular-concurrency/compare/v1.0.1...v1.0.2

## [1.0.1] - 2018-08-01
### Changed
- Updated peer dependencies to be more forgiving

[1.0.1]: https://github.com/happycollision/angular-concurrency/compare/v1.0.0...v1.0.1

## [1.0.0] - 2018-07-02
### Changed
- Changelog is now this file.

### Added
- `task.perform()` now takes whatever arguments you'd like to pass to your generator.

[1.0.0]: https://github.com/happycollision/angular-concurrency/compare/v1.0.0-beta.1...v1.0.0

## 1.0.0-beta.1 - 2018-06-01
### Added
- Initial... so everything.
