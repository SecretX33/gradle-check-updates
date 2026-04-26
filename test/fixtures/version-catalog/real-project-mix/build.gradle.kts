import io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    base
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.spring) apply false
    alias(libs.plugins.kotlin.jpa) apply false
    alias(libs.plugins.kotlin.noarg) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.allopen) apply false
    alias(libs.plugins.spring.dependency.management)
}

// Define a component metadata rule to enforce Jackson BOM alignment
// Must be a top-level class, not an inner class
open class JacksonBomAlignmentRule @Inject constructor(
    private val jacksonVersion: String,
) : ComponentMetadataRule {
    override fun execute(ctx: ComponentMetadataContext) {
        ctx.details.run {
            if (id.group.startsWith("com.fasterxml.jackson")) {
                // declare that Jackson modules belong to the platform defined by the Jackson BOM
                belongsTo("com.fasterxml.jackson:jackson-bom:$jacksonVersion", false)
            }
        }
    }
}

// Apply the Spring Dependency Management plugin to the root project
the<DependencyManagementExtension>().apply {
    imports {
        mavenBom("com.fasterxml.jackson:jackson-bom:${libs.versions.jackson.bom.get()}")
    }
}

// Configure root clean task to also delete external cache directories
tasks.named<Delete>("clean") {
    delete(file("build-cache"), file(".kotlin"))
}

subprojects {
    apply(plugin = "kotlin")
    apply(plugin = "io.spring.dependency-management")
    apply(plugin = "org.jetbrains.kotlin.plugin.spring")

    configurations.all {
        resolutionStrategy {
            // Cache dynamic versions for 10 minutes in development
            cacheDynamicVersionsFor(10, TimeUnit.MINUTES)
            // Cache changing modules for 10 minutes in development
            cacheChangingModulesFor(10, TimeUnit.MINUTES)

            // Force protobuf-java to 4.28.3 for Micrometer 1.15.3 compatibility
            force("com.google.protobuf:protobuf-java:4.28.3")
            force("com.google.protobuf:protobuf-java-util:4.28.3")

            // Force nimbus-jose-jwt to 9.37.4 - CVE fix for DoS via nested JSON in JWT claims
            // Waiting on Spring Security to bump oauth2-oidc-sdk: https://github.com/spring-projects/spring-security/issues/17875
            force("com.nimbusds:nimbus-jose-jwt:9.37.4")
        }

        // Exclude org.json from Jedis to avoid duplicate JSONObject classes
        exclude(group = "org.json", module = "json")
        exclude(group = "commons-logging", module = "commons-logging")
    }

    tasks.withType<Test> {
        useJUnitPlatform()

        testLogging {
            events("passed", "skipped", "failed")
            showExceptions = true
            showStackTraces = true
            showCauses = true
            exceptionFormat = TestExceptionFormat.FULL
        }

        // Add JVM arg to enable dynamic agent loading (for ByteBuddy/MockK)
        jvmArgs(
            "-Dmockito.mock.maker=inline",
            "--add-opens=java.base/java.io=ALL-UNNAMED",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.time=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED",
            "-XX:+EnableDynamicAgentLoading",
        )
    }

    // Enable dependency locking for reproducible builds
    dependencyLocking {
        lockAllConfigurations()
    }

    // Optimize task execution
    tasks.withType<JavaCompile> {
        options.isFork = true
        options.isIncremental = true
        // Enable caching for Java compilation
        outputs.cacheIf { true }
    }

    tasks.withType<KotlinCompile> {
        compilerOptions {
            allWarningsAsErrors = false
            jvmTarget.set(JvmTarget.JVM_21)
            // Use addAll to append to existing args if set by subprojects
            if (!freeCompilerArgs.get().contains("-Xjsr305=strict")) {
                freeCompilerArgs.add("-Xjsr305=strict")
            }
            if (!freeCompilerArgs.get().contains("-Xannotation-default-target=param-property")) {
                freeCompilerArgs.add("-Xannotation-default-target=param-property")
            }
            apiVersion.set(KotlinVersion.KOTLIN_2_3)
            languageVersion.set(KotlinVersion.KOTLIN_2_3)
        }
    }

    setOf("compileClasspath", "testCompileClasspath").forEach {
        configurations.named(it) {
            exclude(group = "org.threeten")
        }
    }

    // Optimize Jar tasks
    tasks.withType<Jar> {
        // Enable caching for Jar tasks
        outputs.cacheIf { true }
        // Optimize Jar creation
        duplicatesStrategy = DuplicatesStrategy.WARN
    }
}
