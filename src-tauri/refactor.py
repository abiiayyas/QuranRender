import re

with open('src/commands.rs', 'r') as f:
    content = f.read()

# Replace Result<..., String> with Result<..., AppError>
content = re.sub(r'Result<(.+?), String>', r'Result<\1, crate::error::AppError>', content)

# Remove .map_err(|e| e.to_string())
content = content.replace('.map_err(|e| e.to_string())', '')

with open('src/commands.rs', 'w') as f:
    f.write(content)

with open('src/render.rs', 'r') as f:
    content = f.read()
content = re.sub(r'Result<(.+?), String>', r'Result<\1, crate::error::AppError>', content)
content = content.replace('.map_err(|e| e.to_string())', '')
with open('src/render.rs', 'w') as f:
    f.write(content)
