import re

def fix_rust_errors():
    # Fix commands.rs
    with open('src/commands.rs', 'r') as f:
        content = f.read()

    # Any returning format!("...").into() instead of format!("...") when expected AppError
    # We can just change all `Err(format!(...))` to `Err(format!(...).into())`
    content = re.sub(r'Err\((format!.*?)\)', r'Err(\1.into())', content)
    # Also `Err("...".to_string())` to `Err("...".to_string().into())`
    content = re.sub(r'Err\(([^)]+\.to_string\(\))\)', r'Err(\1.into())', content)
    
    with open('src/commands.rs', 'w') as f:
        f.write(content)

    # Fix render.rs
    with open('src/render.rs', 'r') as f:
        content = f.read()

    content = re.sub(r'Err\((format!.*?)\)', r'Err(\1.into())', content)
    content = re.sub(r'Err\(([^)]+\.to_string\(\))\)', r'Err(\1.into())', content)
    
    content = content.replace('.ok_or("Worker not initialized")?', '.ok_or("Worker not initialized".to_string())?')
    content = content.replace('error: Some(e),', 'error: Some(e.to_string()),')
    
    with open('src/render.rs', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    fix_rust_errors()
