use std::{fs, path::Path};

use crate::model::{INDEX_DIR_NAME, ProjectIndexError, ProjectIndexResult};

const GITIGNORE_ENTRY: &str = ".etyon-snapshot/";

/// Ensures Git projects ignore the local Etyon index directory.
///
/// # Errors
///
/// Returns an error when `.gitignore` cannot be read or written.
pub fn ensure_project_index_gitignored(project_path: &Path) -> ProjectIndexResult<bool> {
    if !is_git_project(project_path) {
        return Ok(false);
    }

    let gitignore_path = project_path.join(".gitignore");

    if !gitignore_path.exists() {
        fs::write(&gitignore_path, format!("{GITIGNORE_ENTRY}\n"))
            .map_err(ProjectIndexError::WriteFile)?;
        return Ok(true);
    }

    let existing = fs::read_to_string(&gitignore_path).map_err(ProjectIndexError::ReadFile)?;

    if has_gitignore_entry(&existing) {
        return Ok(false);
    }

    let mut next = existing;

    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }

    next.push_str(GITIGNORE_ENTRY);
    next.push('\n');
    fs::write(&gitignore_path, next).map_err(ProjectIndexError::WriteFile)?;

    Ok(true)
}

fn is_git_project(project_path: &Path) -> bool {
    let git_path = project_path.join(".git");
    git_path.is_dir() || git_path.is_file()
}

fn has_gitignore_entry(contents: &str) -> bool {
    contents.lines().any(|line| {
        let trimmed = line.trim();
        trimmed == GITIGNORE_ENTRY || trimmed == INDEX_DIR_NAME
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn does_not_create_gitignore_for_non_git_project() {
        let dir = tempdir().expect("create temp dir");

        let changed = ensure_project_index_gitignored(dir.path()).expect("ensure gitignore");

        assert!(!changed);
        assert!(!dir.path().join(".gitignore").exists());
    }

    #[test]
    fn creates_gitignore_for_git_project() {
        let dir = tempdir().expect("create temp dir");
        fs::create_dir(dir.path().join(".git")).expect("create .git");

        let changed = ensure_project_index_gitignored(dir.path()).expect("ensure gitignore");

        assert!(changed);
        assert_eq!(
            fs::read_to_string(dir.path().join(".gitignore")).expect("read .gitignore"),
            ".etyon-snapshot/\n"
        );
    }

    #[test]
    fn avoids_duplicate_gitignore_entries() {
        let dir = tempdir().expect("create temp dir");
        fs::create_dir(dir.path().join(".git")).expect("create .git");
        fs::write(dir.path().join(".gitignore"), "dist/\n.etyon-snapshot/\n")
            .expect("write .gitignore");

        let changed = ensure_project_index_gitignored(dir.path()).expect("ensure gitignore");

        assert!(!changed);
        assert_eq!(
            fs::read_to_string(dir.path().join(".gitignore")).expect("read .gitignore"),
            "dist/\n.etyon-snapshot/\n"
        );
    }
}
