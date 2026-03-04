# Converting ShaderToy Fragments to WebGL

Below are typical modifications needed:

1. Add the following to the start of the fragment:
   ```glsl
   #ifdef GL_ES
   precision highp float;
   #endif
   ```
   This ensures correct precision in WebGL.

2. Rename the uniform variables:
   - Replace `uniform float u_time;` with `uniform float iTime;`
   - Replace `uniform vec2 u_resolution;` with `uniform vec2 iResolution;`
   This matches the naming convention often used in Shadertoy-like WebGL pipelines.

3. Update references in the code to use `iTime` and `iResolution` instead of `u_time` and `u_resolution`. For example:
   ```glsl
   // Before:
   f += 0.500000*noise(p + 0.4*u_time);

   // After:
   f += 0.500000*noise(p + 0.4*iTime);
   ```
   And similarly for any lines using `u_resolution`.

4. In the main function, replace:
   ```glsl
   vec2 uv = gl_FragCoord.xy / u_resolution.x;
   ```
   with:
   ```glsl
   vec2 uv = gl_FragCoord.xy / iResolution.x;
   ```
   to remain consistent with your renamed uniform.

Example final structure:
```glsl
//** Minor edit of "Base warp fBM" shader by ...
#ifdef GL_ES
precision highp float;
#endif

uniform float iTime;
uniform vec2 iResolution;

// ...existing code changes and references to iTime/iResolution...
void main()
{
    // ...existing code...
}
```

This set of changes typically ensures that a Shadertoy-style fragment will compile and run in a standard WebGL setup.

# Understanding ShaderToy vs WebGL Variable Names

## Why Variables Need to Be Changed

ShaderToy and WebGL use different naming conventions for their uniform variables due to their different implementations:

### ShaderToy's Default Variables
- `u_time` - ShaderToy's internal time variable
- `u_resolution` - ShaderToy's screen resolution
The prefix `u_` is a common convention meaning "uniform"

### WebGL Implementation
- `iTime` - Standard WebGL time uniform
- `iResolution` - Standard WebGL resolution uniform
The prefix `i` comes from historical GLSL conventions

## Why It Doesn't Work Without Changes

The reason the shader won't work without changing the variable names is because:

1. **Binding Contract**: When you set up uniforms in WebGL (JavaScript side), you bind them using specific names:
   ```javascript
   const uTime = gl.getUniformLocation(program, "iTime");
   const uResolution = gl.getUniformLocation(program, "iResolution");
   ```

2. **Missing Variables**: If the shader uses `u_time` but the JavaScript code is looking for `iTime`, the uniform binding will fail and return null. This means:
   - The shader won't receive time updates
   - The resolution information will be missing
   - The shader might compile but won't animate or scale correctly

3. **Historical Context**: ShaderToy uses its own conventions (`u_*`), while many WebGL implementations followed the conventions popularized by earlier shader platforms (`i*`). Our WebGL setup uses the `i*` convention, so shaders need to match.

## Example Impact
```glsl
// ShaderToy version (won't work in our setup)
uniform float u_time;
float f = sin(u_time);

// WebGL version (will work)
uniform float iTime;
float f = sin(iTime);
```

The actual values and functionality are identical - it's purely a naming convention issue that needs to be matched between the JavaScript uniform bindings and the GLSL shader code.