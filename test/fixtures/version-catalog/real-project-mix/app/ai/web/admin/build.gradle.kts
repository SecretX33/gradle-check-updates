import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.allopen)
    id("org.jetbrains.kotlin.kapt")
    id("java-test-fixtures")
}

group = "com.example.web.admin"
version = "1.0.0-SNAPSHOT"

// Align Java compatibility style with the reference
java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<KotlinCompile> {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.set(listOf(
            "-Xjsr305=strict",
            "-Xannotation-default-target=param-property"
        ))
    }
    // Enable caching for Kotlin compilation outputs
    outputs.cacheIf { true }
}

configurations {
    compileOnly {
        extendsFrom(configurations.annotationProcessor.get())
    }
}


dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:web:m1-data"))
    implementation(project(":app:web:m2-services"))
    implementation(project(":app:ai:m1-data"))
    implementation(project(":app:ai:m2-services"))
    implementation(project(":app:ai:m5-api"))
    implementation(project(":app:supply:m1-data"))
    implementation(project(":app:content:m1-data"))
    implementation(project(":app:content:m2-services"))
    implementation(project(":app:content:m5-api"))
    implementation(project(":app:web:m2-core"))

    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.spring.boot.starter.security)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.data.commons)

    implementation(libs.bundles.kotlin.core)
    implementation(libs.bundles.kotlin.coroutines)

    implementation(libs.hypersistence.utils)
    implementation(libs.commons.csv)

    // AWS SDK
    implementation(libs.aws.sdk.s3)
    implementation(libs.aws.sdk.dynamodb)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.h2)
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.assertj.core)

    // Logback
    implementation(libs.logstash.logback.encoder)
}

// Configure Jar task (aligning with reference - likely a library, not a bootable JAR)
tasks.jar {
    enabled = true
    // archiveBaseName.set("admin-lib") // Set appropriate name
    archiveClassifier.set("") // No classifier usually needed for main library JAR
    // Optimize Jar creation
    duplicatesStrategy = DuplicatesStrategy.WARN
    // Enable caching for Jar tasks
    outputs.cacheIf { true }
}

// Disable bootJar as this is likely a library module
tasks.bootJar {
    enabled = false
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}
