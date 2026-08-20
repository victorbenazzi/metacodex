use std::collections::{HashMap, HashSet};

pub fn parse_process_table(text: &str, root_pid: u32) -> Vec<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let Some(pid) = fields.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        let Some(ppid) = fields.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        children.entry(ppid).or_default().push(pid);
    }
    let mut owned = Vec::new();
    let mut seen = HashSet::new();
    let mut pending = vec![root_pid];
    while let Some(pid) = pending.pop() {
        if !seen.insert(pid) {
            continue;
        }
        owned.push(pid);
        if let Some(direct) = children.get(&pid) {
            pending.extend(direct.iter().copied());
        }
    }
    owned.sort_unstable();
    owned
}

#[cfg(target_os = "macos")]
pub fn owned_process_ids(root_pid: u32) -> Option<Vec<u32>> {
    let output = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(parse_process_table(
        &String::from_utf8_lossy(&output.stdout),
        root_pid,
    ))
}

#[cfg(target_os = "windows")]
pub fn owned_process_ids(root_pid: u32) -> Option<Vec<u32>> {
    use windows::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut rows = String::new();
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                rows.push_str(&format!(
                    "{} {}\n",
                    entry.th32ProcessID, entry.th32ParentProcessID
                ));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        Some(parse_process_table(&rows, root_pid))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn owned_process_ids(_root_pid: u32) -> Option<Vec<u32>> {
    None
}

#[cfg(test)]
mod tests {
    use super::parse_process_table;

    #[test]
    fn attributes_only_root_and_descendants() {
        let table = "10 1\n11 10\n12 11\n20 1\n21 20\n";
        assert_eq!(parse_process_table(table, 10), vec![10, 11, 12]);
    }

    #[test]
    fn handles_cycles_without_duplicate_processes() {
        let table = "10 11\n11 10\n";
        assert_eq!(parse_process_table(table, 10), vec![10, 11]);
    }
}
