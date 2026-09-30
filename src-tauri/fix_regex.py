import re

def fix_rust_errors():
    with open('src/commands.rs', 'r') as f:
        content = f.read()

    # Fix the messed up .into() inside other functions' parens
    content = content.replace('.status(.into())', '.status()')
    content = content.replace('provider.into()', 'provider')
    
    # Fix missing .into() outside the format! string
    # We want Err(format!(...)) to be Err(format!(...).into())
    # The previous regex might have missed if there was a `)` mismatch or it just didn't run properly.
    # Actually the compiler said: `Err(format!("Failed to download audio. Status: {}", response.status()))` -> `... expected AppError`
    content = re.sub(r'(Err\(format!.*?\))', lambda m: m.group(1) + '.into()' if '.into())' not in m.group(1) + '.into()' else m.group(1), content)
    # The above regex might be tricky if parens are nested.
    
    with open('src/commands.rs', 'w') as f:
        f.write(content)

    with open('src/render.rs', 'r') as f:
        content = f.read()

    content = content.replace('.trim(.into())', '.trim()')
    content = content.replace('stalled.into()', 'stalled')
    content = content.replace('e.into()', 'e')
    
    with open('src/render.rs', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    fix_rust_errors()
